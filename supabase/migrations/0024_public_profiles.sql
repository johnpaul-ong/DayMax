-- DayMax migration 24: public profiles, per-audience visibility, no more
-- under-18 special-casing.
--
-- WHAT CHANGES
--   * profiles.is_public (default true) — anyone signed in can open your page.
--   * profiles.public_sections — what NON-friends see. profile_sections stays
--     as what friends see. Two audiences, two lists.
--   * Profile data no longer flows through "do we share a track" — that meant a
--     stranger with a public profile showed a blank page. New readers gate on
--     visibility directly.
--   * is_minor() is no longer used to hide people. The function stays (nothing
--     depends on removing it) but search and rosters no longer filter on age.

alter table public.profiles add column if not exists is_public boolean not null default true;
alter table public.profiles add column if not exists public_sections jsonb
  not null default '["ranking","hours","lifts"]'::jsonb;

-- existing accounts opt in to the new default
update public.profiles set is_public = true where is_public is null;

-- Can the caller open this profile at all?
create or replace function public.can_view_profile(member uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select member = auth.uid()
      or public.is_connected(member)
      or exists (select 1 from public.profiles p where p.id = member and p.is_public);
$$;

-- Which sections does THIS caller get? Own profile and friends get the full
-- list; everyone else gets the public subset.
create or replace function public.visible_sections(member uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select case
    when member = auth.uid() then coalesce(p.profile_sections, '["ranking","hours","lifts"]'::jsonb)
    when public.is_connected(member) then coalesce(p.profile_sections, '["ranking","hours","lifts"]'::jsonb)
    when p.is_public then coalesce(p.public_sections, '["ranking","hours","lifts"]'::jsonb)
    else '[]'::jsonb
  end
  from public.profiles p where p.id = member;
$$;

create or replace function public.section_visible(member uuid, s text)
returns boolean language sql security definer stable set search_path = public as $$
  select public.visible_sections(member) ? s;
$$;

-- profile header, plus everything the page needs to render the right buttons.
-- Postgres won't let create-or-replace change a function's OUT columns, and
-- this one gains is_public / is_self / friend_status — so drop it first.
drop function if exists public.member_profile(uuid);

create function public.member_profile(member uuid)
returns table (display_name text, username text, sections jsonb,
               is_public boolean, is_self boolean, friend_status text)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.can_view_profile(member) then
    raise exception 'This profile is private';
  end if;
  return query
  select coalesce(p.display_name, 'anonymous'),
         p.username,
         public.visible_sections(member),
         p.is_public,
         member = auth.uid(),
         case
           when member = auth.uid() then 'self'
           when public.are_friends(auth.uid(), member) then 'friends'
           when exists (select 1 from public.friendships f
                        where f.requester = auth.uid() and f.addressee = member and f.status = 'pending')
             then 'pending_out'
           when exists (select 1 from public.friendships f
                        where f.requester = member and f.addressee = auth.uid() and f.status = 'pending')
             then 'pending_in'
           else 'none'
         end
  from public.profiles p where p.id = member;
end $$;

-- Day totals for a profile, gated on visibility rather than on sharing a
-- track. This is what makes a public profile actually show something.
create or replace function public.member_day_totals(member uuid, from_date date default null, to_date date default null)
returns table (date date, productive numeric, brainrot numeric, social numeric, other numeric)
language plpgsql security definer stable set search_path = public as $$
declare
  is_demo_member boolean;
  local_ts timestamp;
  local_day date;
  local_slot int;
begin
  if not public.can_view_profile(member) then raise exception 'This profile is private'; end if;
  if not (public.section_visible(member, 'ranking') or public.section_visible(member, 'hours')) then
    return;
  end if;

  select p.is_demo into is_demo_member from public.profiles p where p.id = member;
  local_ts := public.viewer_local_ts();
  local_day := local_ts::date;
  local_slot := extract(hour from local_ts)::int * 4 + extract(minute from local_ts)::int / 15;

  return query
  select e.date,
         sum(case when e.category in (1, 2) then 0.25 else 0 end),
         sum(case when e.category in (6, 9) then 0.25 else 0 end),
         sum(case when e.category = 3 then 0.25 else 0 end),
         sum(case when e.category not in (1, 2, 3, 6, 9) then 0.25 else 0 end)
  from public.day_entries e
  where e.user_id = member
    and (from_date is null or e.date >= from_date)
    and (to_date is null or e.date <= to_date)
    and (not coalesce(is_demo_member, false)
         or e.date < local_day
         or (e.date = local_day and e.slot <= local_slot))
  group by e.date
  order by e.date;
end $$;

create or replace function public.member_lifts(member uuid)
returns table (date date, exercise text, weight_kg numeric, reps text)
language plpgsql security definer stable set search_path = public as $$
declare
  is_demo_member boolean;
  local_day date;
begin
  if not public.can_view_profile(member) then raise exception 'This profile is private'; end if;
  if not public.section_visible(member, 'lifts') then return; end if;

  select p.is_demo into is_demo_member from public.profiles p where p.id = member;
  local_day := public.viewer_local_ts()::date;

  return query
  select l.date, l.exercise, l.weight_kg, l.reps
  from public.lift_entries l
  where l.user_id = member
    and l.weight_kg is not null
    and (not coalesce(is_demo_member, false) or l.date < local_day)
  order by l.date;
end $$;

-- metrics follow their own section
create or replace function public.member_day_metrics(member uuid)
returns table (date date, emotional_score numeric, tired numeric, start_friction numeric, end_brain_fatigue numeric, weight_kg numeric)
language plpgsql security definer stable set search_path = public as $$
declare
  is_demo_member boolean;
  local_day date;
begin
  if not public.can_view_profile(member) then raise exception 'This profile is private'; end if;
  if not public.section_visible(member, 'metrics') then return; end if;

  select p.is_demo into is_demo_member from public.profiles p where p.id = member;
  local_day := public.viewer_local_ts()::date;

  return query
  select m.date, m.emotional_score, m.tired, m.start_friction, m.end_brain_fatigue, m.weight_kg
  from public.day_metrics m
  where m.user_id = member
    and (not coalesce(is_demo_member, false) or m.date < local_day)
  order by m.date;
end $$;

-- The 15-minute strip. Categories follow the 'days' section; LABELS are
-- stricter — only yourself, demo legends, or someone who explicitly set
-- raw_labels on a shared track ever sees the words you wrote.
drop function if exists public.member_day_strip(uuid);
drop function if exists public.member_day_strip(uuid, date, date);

create function public.member_day_strip(member uuid, from_date date default null, to_date date default null)
returns table (date date, slot smallint, category smallint, label text)
language plpgsql security definer stable set search_path = public as $$
declare
  is_demo_member boolean;
  show_labels boolean;
  local_ts timestamp;
  local_day date;
  local_slot int;
begin
  if not public.can_view_profile(member) then raise exception 'This profile is private'; end if;
  if not public.section_visible(member, 'days') then return; end if;

  select p.is_demo into is_demo_member from public.profiles p where p.id = member;

  show_labels := member = auth.uid()
      or coalesce(is_demo_member, false)
      or exists (
        select 1 from public.track_members a
        join public.track_members b on a.track_id = b.track_id
        where a.user_id = auth.uid() and b.user_id = member and b.share_rule = 'raw_labels'
      );

  local_ts := public.viewer_local_ts();
  local_day := local_ts::date;
  local_slot := extract(hour from local_ts)::int * 4 + extract(minute from local_ts)::int / 15;

  return query
  select e.date, e.slot, e.category,
         case when show_labels then e.label else null end
  from public.day_entries e
  where e.user_id = member
    and (from_date is null or e.date >= from_date)
    and (to_date is null or e.date <= to_date)
    and (not coalesce(is_demo_member, false)
         or e.date < local_day
         or (e.date = local_day and e.slot <= local_slot))
  order by e.date, e.slot;
end $$;

-- No more age gating -----------------------------------------------------------

create or replace function public.search_profiles(q text)
returns table (member_id uuid, display_name text, username text)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  return query
  select p.id, coalesce(p.display_name, 'anonymous'), p.username
  from public.profiles p
  where p.discoverable
    and not p.is_demo
    and p.id <> auth.uid()
    and (p.display_name ilike '%' || q || '%' or p.username ilike '%' || q || '%')
  limit 20;
end $$;

create or replace function public.pursuit_member_list(p uuid)
returns table (member_id uuid, display_name text, username text, role text, is_demo boolean, is_visible boolean)
language plpgsql security definer stable set search_path = public as $$
declare
  k text;
  can_see boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  select pu.kind,
         (pu.is_public or pu.owner_id is null or pu.owner_id = auth.uid() or public.is_pursuit_member(pu.id))
    into k, can_see
  from public.pursuits pu where pu.id = p;

  if k is null then raise exception 'No such pursuit'; end if;
  if not can_see then raise exception 'You cannot see this pursuit'; end if;
  if k = 'life' then return; end if;   -- everyone is in Life; no roster

  return query
  select m.user_id,
         coalesce(pr.display_name, 'anonymous'),
         pr.username,
         m.role,
         coalesce(pr.is_demo, false),
         public.can_view_profile(m.user_id)
  from public.pursuit_members m
  left join public.profiles pr on pr.id = m.user_id
  where m.pursuit_id = p
    and (k = 'custom' or public.is_connected(m.user_id) or coalesce(pr.is_public, false))
  order by (m.role = 'owner') desc, coalesce(pr.display_name, 'anonymous');
end $$;
