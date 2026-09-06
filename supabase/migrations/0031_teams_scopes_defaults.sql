-- DayMax migration 31: team colours everywhere, honest Arena scopes, a default
-- lift, and member lists on every pursuit.

-- 1. A default exercise for your profile's Lifts chart ------------------------
alter table public.profiles add column if not exists default_exercise text;

-- 2. Team travels with the person ---------------------------------------------
-- Every list that shows a name now also returns their team, so the UI can put a
-- discreet colour on it without a second lookup per row.

drop function if exists public.member_profile(uuid);
create function public.member_profile(member uuid)
returns table (display_name text, username text, sections jsonb,
               is_public boolean, is_self boolean, friend_status text,
               team text, default_exercise text)
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
         end,
         coalesce(p.theme, 'light'),
         p.default_exercise
  from public.profiles p where p.id = member;
end $$;

-- 3. Member lists on EVERY pursuit, including Life ----------------------------
-- Reverses the earlier "Life has no roster" rule at the owner's request. Note
-- the trade-off: Life contains every account, so its roster IS a user
-- directory. Private profiles still render un-clickable (is_visible = false).
drop function if exists public.pursuit_member_list(uuid);
create function public.pursuit_member_list(p uuid, limit_n int default 500)
returns table (member_id uuid, display_name text, username text, role text,
               is_demo boolean, is_visible boolean, team text)
language plpgsql security definer stable set search_path = public as $$
declare
  can_see boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select (pu.is_public or pu.owner_id is null or pu.owner_id = auth.uid() or public.is_pursuit_member(pu.id))
    into can_see
  from public.pursuits pu where pu.id = p;
  if can_see is null then raise exception 'No such pursuit'; end if;
  if not can_see then raise exception 'You cannot see this pursuit'; end if;

  return query
  select m.user_id,
         coalesce(pr.display_name, 'anonymous'),
         pr.username,
         m.role,
         coalesce(pr.is_demo, false),
         public.can_view_profile(m.user_id),
         coalesce(pr.theme, 'light')
  from public.pursuit_members m
  left join public.profiles pr on pr.id = m.user_id
  where m.pursuit_id = p
  order by (m.role = 'owner') desc, coalesce(pr.display_name, 'anonymous')
  limit least(greatest(coalesce(limit_n, 500), 1), 2000);
end $$;

-- 4. Arena scopes that mean what they say -------------------------------------
--   'friends'  — accepted friendships only. NOT demo accounts, not people you
--                merely share a track with. Previously this was "everyone
--                who isn't a legend", which quietly included strangers.
--   'everyone' — literally everyone with a public profile, plus your friends
--                and the legends. Previously capped at people you already knew.
--   'demo'     — the Avengers Assemble cast, plus you.
--   'track'    — the members of one track you belong to.
create or replace function public.arena_day_totals(
  scope text default 'everyone',
  t uuid default null,
  from_date date default null,
  to_date date default null
)
returns table (member_id uuid, display_name text, is_demo boolean, team text, date date,
               productive numeric, brainrot numeric, social numeric, other numeric)
language plpgsql security definer stable set search_path = public as $$
declare
  local_ts timestamp;
  local_day date;
  local_slot int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if scope = 'track' and (t is null or not public.is_track_member(t)) then
    raise exception 'Not a member of this track';
  end if;

  local_ts := public.viewer_local_ts();
  local_day := local_ts::date;
  local_slot := extract(hour from local_ts)::int * 4 + extract(minute from local_ts)::int / 15;

  return query
  with visible as (
    select p.id, coalesce(p.display_name, 'anonymous') as name,
           coalesce(p.is_demo, false) as demo, coalesce(p.theme, 'light') as tm
    from public.profiles p
    where case scope
      when 'friends'  then p.id = auth.uid() or public.are_friends(auth.uid(), p.id)
      when 'demo'     then p.id = auth.uid() or p.is_demo
      when 'track'    then exists (select 1 from public.track_members m
                                    where m.track_id = t and m.user_id = p.id and m.share_rule <> 'hidden')
      else                 p.id = auth.uid() or p.is_demo or p.is_public
                           or public.are_friends(auth.uid(), p.id)
    end
  )
  select v.id, v.name, v.demo, v.tm, e.date,
         sum(case when e.category in (1, 2) then 0.25 else 0 end),
         sum(case when e.category in (6, 9) then 0.25 else 0 end),
         sum(case when e.category = 3 then 0.25 else 0 end),
         sum(case when e.category not in (1, 2, 3, 6, 9) then 0.25 else 0 end)
  from visible v
  join public.day_entries e on e.user_id = v.id
  where (from_date is null or e.date >= from_date)
    and (to_date is null or e.date <= to_date)
    and (not v.demo or e.date < local_day or (e.date = local_day and e.slot <= local_slot))
  group by v.id, v.name, v.demo, v.tm, e.date;
end $$;

-- Team standings honour the same scopes, so "You vs Friends" team scores are
-- built from friends only rather than from everyone the query happened to see.
create or replace function public.team_totals(
  from_date date default null,
  to_date date default null,
  scope text default 'everyone',
  t uuid default null
)
returns table (team text, members bigint, work_max numeric, productive numeric, brainrot numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  return query
  with per_person as (
    select a.team, a.member_id,
           sum(a.productive) as prod,
           sum(a.brainrot) as rot
    from public.arena_day_totals(scope, t, from_date, to_date) a
    group by a.team, a.member_id
  )
  select pp.team, count(*)::bigint,
         round(avg(case when pp.prod + pp.rot > 0 then pp.prod / (pp.prod + pp.rot) * pp.prod else 0 end)::numeric, 1),
         round(sum(pp.prod)::numeric, 0),
         round(sum(pp.rot)::numeric, 0)
  from per_person pp group by pp.team order by 3 desc;
end $$;

-- 5. Bodyweight is standard on every profile ----------------------------------
-- It already rides along in member_day_metrics; this exposes the series the
-- Lifts section needs so a profile always has at least one weight chart.
create or replace function public.member_bodyweight(member uuid)
returns table (date date, weight_kg numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.can_view_profile(member) then raise exception 'This profile is private'; end if;
  if not public.section_visible(member, 'lifts') then return; end if;
  return query
  select d.date, d.value
  from public.daily_metrics d
  where d.user_id = member and d.metric = 'bodyweight_kg'
  order by d.date;
end $$;

-- the exercises someone actually logs, for the default-lift picker
create or replace function public.member_exercises(member uuid)
returns table (exercise text, sessions bigint, best numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.can_view_profile(member) then raise exception 'This profile is private'; end if;
  return query
  select l.exercise, count(*), max(l.weight_kg)
  from public.lift_entries l
  where l.user_id = member and l.weight_kg is not null
  group by l.exercise order by 2 desc;
end $$;

create index if not exists daily_metrics_metric_idx on public.daily_metrics (user_id, metric, date);
