-- DayMax migration 12: friend search & requests, consent-first sharing, habits.
-- Minors are NEVER searchable; they add people, people don't add them.
-- Anyone added to a track by its owner joins HIDDEN until they opt in themselves.

-- discoverability is opt-in for everyone
alter table public.profiles add column if not exists discoverable boolean not null default false;

-- friendships ------------------------------------------------------------------
create table public.friendships (
  id bigint generated always as identity primary key,
  requester uuid not null references auth.users (id) on delete cascade,
  addressee uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  unique (requester, addressee),
  check (requester <> addressee)
);
alter table public.friendships enable row level security;
create policy "participants see friendship" on public.friendships
  for select using (requester = auth.uid() or addressee = auth.uid());
create policy "send request" on public.friendships
  for insert with check (requester = auth.uid() and status = 'pending');
create policy "addressee accepts" on public.friendships
  for update using (addressee = auth.uid()) with check (status = 'accepted');
create policy "either side removes" on public.friendships
  for delete using (requester = auth.uid() or addressee = auth.uid());

create function public.are_friends(a uuid, b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a))
  );
$$;

-- search: discoverable adults only. Minors never appear, demo accounts never appear.
create function public.search_profiles(q text)
returns table (member_id uuid, display_name text, username text)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  return query
  select p.id, coalesce(p.display_name, 'anonymous'), split_part(u.email, '@', 1)
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.discoverable
    and not p.is_demo
    and not public.is_minor(p.id)
    and p.id <> auth.uid()
    and (p.display_name ilike '%' || q || '%' or split_part(u.email, '@', 1) ilike '%' || q || '%')
  limit 20;
end $$;

-- list my friendships (both directions, with names)
create function public.list_friends()
returns table (friendship_id bigint, member_id uuid, display_name text, username text, status text, direction text)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  return query
  select f.id,
         case when f.requester = auth.uid() then f.addressee else f.requester end,
         coalesce(p.display_name, 'anonymous'),
         split_part(u.email, '@', 1),
         f.status,
         case when f.requester = auth.uid() then 'outgoing' else 'incoming' end
  from public.friendships f
  join public.profiles p on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
  join auth.users u on u.id = p.id
  where f.requester = auth.uid() or f.addressee = auth.uid()
  order by f.created_at desc;
end $$;

-- connection = self, demo, shared track, or accepted friendship
create function public.is_connected(member uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select member = auth.uid()
      or exists (select 1 from public.profiles p where p.id = member and p.is_demo)
      or public.are_friends(auth.uid(), member)
      or exists (
        select 1 from public.track_members a
        join public.track_members b on a.track_id = b.track_id
        where a.user_id = auth.uid() and b.user_id = member
      );
$$;

-- profile + metrics now open to friends too (sections/share rules still apply)
create or replace function public.member_profile(member uuid)
returns table (display_name text, username text, sections jsonb)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_connected(member) then
    raise exception 'You are not connected with this person';
  end if;
  return query
  select coalesce(p.display_name, 'anonymous'),
         split_part(u.email, '@', 1),
         coalesce(p.profile_sections, '["ranking","hours","lifts"]'::jsonb)
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = member;
end $$;

create or replace function public.member_day_metrics(member uuid)
returns table (date date, emotional_score numeric, tired numeric, start_friction numeric, end_brain_fatigue numeric, weight_kg numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_connected(member) then
    raise exception 'You are not connected with this person';
  end if;
  return query
  select m.date, m.emotional_score, m.tired, m.start_friction, m.end_brain_fatigue, m.weight_kg
  from public.day_metrics m
  where m.user_id = member
  order by m.date;
end $$;

-- leaderboards: add "other" hours and include accepted friends
drop function if exists public.leaderboard_day_totals();
create function public.leaderboard_day_totals()
returns table (member_id uuid, display_name text, is_demo boolean, date date, productive numeric, brainrot numeric, social numeric, other numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  return query
  with visible as (
    select p.id, coalesce(p.display_name, 'anonymous') as name, p.is_demo
    from public.profiles p
    where p.is_demo
       or p.id = auth.uid()
       or public.are_friends(auth.uid(), p.id)
       or exists (
         select 1 from public.track_members a
         join public.track_members b on a.track_id = b.track_id
         where a.user_id = auth.uid() and b.user_id = p.id and b.share_rule <> 'hidden'
       )
  ),
  buckets as (
    select c.category,
           case when c.category in (1, 2) then 'productive'
                when c.category in (6, 9) then 'brainrot'
                when c.category = 3 then 'social'
                else 'other' end as bucket
    from (select generate_series(0, 9) as category) c
  )
  select v.id, v.name, v.is_demo, e.date,
         sum(case when b.bucket = 'productive' then 0.25 else 0 end),
         sum(case when b.bucket = 'brainrot' then 0.25 else 0 end),
         sum(case when b.bucket = 'social' then 0.25 else 0 end),
         sum(case when b.bucket = 'other' then 0.25 else 0 end)
  from visible v
  join public.day_entries e on e.user_id = v.id
  join buckets b on b.category = e.category
  group by v.id, v.name, v.is_demo, e.date;
end $$;

create or replace function public.leaderboard_lifts()
returns table (member_id uuid, display_name text, date date, exercise text, weight_kg numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  return query
  select p.id, coalesce(p.display_name, 'anonymous'), l.date, l.exercise, l.weight_kg
  from public.profiles p
  join public.lift_entries l on l.user_id = p.id
  where l.weight_kg is not null
    and (p.is_demo
      or p.id = auth.uid()
      or public.are_friends(auth.uid(), p.id)
      or exists (
        select 1 from public.track_members a
        join public.track_members b on a.track_id = b.track_id
        where a.user_id = auth.uid() and b.user_id = p.id and b.share_rule <> 'hidden'
      ));
end $$;

-- owner adds an accepted friend to a track — they join HIDDEN (consent-first)
create function public.add_track_member(t uuid, member uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.tracks tr where tr.id = t and tr.owner_id = auth.uid() and not tr.is_demo) then
    raise exception 'Only the track owner can add members';
  end if;
  if not public.are_friends(auth.uid(), member) then
    raise exception 'You can only add accepted friends';
  end if;
  insert into public.track_members (track_id, user_id, role, share_rule)
  values (t, member, 'member', 'hidden')
  on conflict (track_id, user_id) do nothing;
end $$;

-- habits: shared registry of custom daily metrics ("words_per_day", ...)
create table public.metric_types (
  key text primary key,
  name text not null,
  unit text not null default '',
  direction text not null default 'more' check (direction in ('more', 'less')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.metric_types enable row level security;
create policy "anyone reads metric types" on public.metric_types
  for select using (auth.uid() is not null);
create policy "anyone registers a metric type" on public.metric_types
  for insert with check (auth.uid() = created_by);
