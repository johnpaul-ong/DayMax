-- DayMax migration 19: make the community/Arena reads fast enough to survive
-- the statement timeout.
--
-- What was wrong (all three compounding on the same ~200k day_entries rows):
--   1. demo_row_visible() was called PER ROW, and since migration 18 it also
--      calls viewer_local_ts() — so every single slot row triggered two extra
--      lookups against profiles. Death by a hundred thousand subqueries.
--   2. A `buckets` CTE was JOINed to every row just to map category -> bucket,
--      when a plain CASE does the same thing for free.
--   3. No date filter: the leaderboard returned every day anyone has ever
--      logged, and the client threw most of it away.
--
-- The fix: resolve the viewer's local clock ONCE into a variable, gate demo
-- rows with a plain boolean against the already-joined profile, bucket with
-- CASE, and let callers pass a date window.

-- 1. leaderboard_day_totals(from_date, to_date) ---------------------------------

drop function if exists public.leaderboard_day_totals();
drop function if exists public.leaderboard_day_totals(date, date);

create function public.leaderboard_day_totals(from_date date default null, to_date date default null)
returns table (member_id uuid, display_name text, is_demo boolean, date date, productive numeric, brainrot numeric, social numeric, other numeric)
language plpgsql security definer stable set search_path = public as $$
declare
  local_ts timestamp;
  local_day date;
  local_slot int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  local_ts := public.viewer_local_ts();
  local_day := local_ts::date;
  local_slot := extract(hour from local_ts)::int * 4 + extract(minute from local_ts)::int / 15;

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
  )
  select v.id, v.name, v.is_demo, e.date,
         sum(case when e.category in (1, 2) then 0.25 else 0 end),
         sum(case when e.category in (6, 9) then 0.25 else 0 end),
         sum(case when e.category = 3 then 0.25 else 0 end),
         sum(case when e.category not in (1, 2, 3, 6, 9) then 0.25 else 0 end)
  from visible v
  join public.day_entries e on e.user_id = v.id
  where (from_date is null or e.date >= from_date)
    and (to_date is null or e.date <= to_date)
    and (not v.is_demo
         or e.date < local_day
         or (e.date = local_day and e.slot <= local_slot))
  group by v.id, v.name, v.is_demo, e.date;
end $$;

-- 2. leaderboard_lifts(from_date, to_date) -------------------------------------

drop function if exists public.leaderboard_lifts();
drop function if exists public.leaderboard_lifts(date, date);

create function public.leaderboard_lifts(from_date date default null, to_date date default null)
returns table (member_id uuid, display_name text, date date, exercise text, weight_kg numeric)
language plpgsql security definer stable set search_path = public as $$
declare
  local_day date;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  local_day := public.viewer_local_ts()::date;

  return query
  select p.id, coalesce(p.display_name, 'anonymous'), l.date, l.exercise, l.weight_kg
  from public.profiles p
  join public.lift_entries l on l.user_id = p.id
  where l.weight_kg is not null
    and (from_date is null or l.date >= from_date)
    and (to_date is null or l.date <= to_date)
    and (not p.is_demo or l.date < local_day)
    and (p.is_demo
      or p.id = auth.uid()
      or public.are_friends(auth.uid(), p.id)
      or exists (
        select 1 from public.track_members a
        join public.track_members b on a.track_id = b.track_id
        where a.user_id = auth.uid() and b.user_id = p.id and b.share_rule <> 'hidden'
      ));
end $$;

-- 3. member_day_strip: same per-row-function problem, same fix ------------------

drop function if exists public.member_day_strip(uuid);
drop function if exists public.member_day_strip(uuid, date, date);

create function public.member_day_strip(member uuid, from_date date default null, to_date date default null)
returns table (date date, slot smallint, category smallint, label text)
language plpgsql security definer stable set search_path = public as $$
declare
  is_demo_member boolean;
  local_ts timestamp;
  local_day date;
  local_slot int;
begin
  if member <> auth.uid()
     and not exists (select 1 from public.profiles p where p.id = member and p.is_demo)
     and not exists (
       select 1 from public.track_members a
       join public.track_members b on a.track_id = b.track_id
       where a.user_id = auth.uid() and b.user_id = member and b.share_rule = 'raw_labels'
     ) then
    raise exception 'This person does not share their day detail';
  end if;

  select p.is_demo into is_demo_member from public.profiles p where p.id = member;
  local_ts := public.viewer_local_ts();
  local_day := local_ts::date;
  local_slot := extract(hour from local_ts)::int * 4 + extract(minute from local_ts)::int / 15;

  return query
  select e.date, e.slot, e.category, e.label
  from public.day_entries e
  where e.user_id = member
    and (from_date is null or e.date >= from_date)
    and (to_date is null or e.date <= to_date)
    and (not coalesce(is_demo_member, false)
         or e.date < local_day
         or (e.date = local_day and e.slot <= local_slot))
  order by e.date, e.slot;
end $$;

-- 4. member_day_metrics: one row per day, but gate it cheaply too ---------------

create or replace function public.member_day_metrics(member uuid)
returns table (date date, emotional_score numeric, tired numeric, start_friction numeric, end_brain_fatigue numeric, weight_kg numeric)
language plpgsql security definer stable set search_path = public as $$
declare
  is_demo_member boolean;
  local_day date;
begin
  if not public.is_connected(member) then
    raise exception 'You are not connected with this person';
  end if;
  select p.is_demo into is_demo_member from public.profiles p where p.id = member;
  local_day := public.viewer_local_ts()::date;

  return query
  select m.date, m.emotional_score, m.tired, m.start_friction, m.end_brain_fatigue, m.weight_kg
  from public.day_metrics m
  where m.user_id = member
    and (not coalesce(is_demo_member, false) or m.date < local_day)
  order by m.date;
end $$;

-- 5. compare_day_totals: same treatment (track Compare hits this) ---------------

create or replace function public.compare_day_totals(t uuid)
returns table (member_id uuid, display_name text, date date, productive numeric, brainrot numeric, other numeric)
language plpgsql security definer stable set search_path = public as $$
declare
  local_ts timestamp;
  local_day date;
  local_slot int;
begin
  if not public.is_track_member(t) then raise exception 'Not a member of this track'; end if;
  local_ts := public.viewer_local_ts();
  local_day := local_ts::date;
  local_slot := extract(hour from local_ts)::int * 4 + extract(minute from local_ts)::int / 15;

  return query
  with owner_buckets as (
    select bs.category, bs.bucket
    from public.bucket_settings bs
    join public.tracks tr on tr.owner_id = bs.user_id
    where tr.id = t
  ),
  buckets as (
    select c.category,
           coalesce(ob.bucket,
             case when c.category in (1, 2) then 'productive'
                  when c.category in (6, 9) then 'brainrot'
                  else 'other' end) as bucket
    from (select generate_series(0, 9) as category) c
    left join owner_buckets ob on ob.category = c.category
  ),
  members as (
    select m.user_id, coalesce(p.display_name, 'anonymous') as name, coalesce(p.is_demo, false) as is_demo
    from public.track_members m
    left join public.profiles p on p.id = m.user_id
    where m.track_id = t and m.share_rule <> 'hidden'
  )
  select mm.user_id, mm.name, e.date,
         sum(case when b.bucket = 'productive' then 0.25 else 0 end),
         sum(case when b.bucket = 'brainrot' then 0.25 else 0 end),
         sum(case when b.bucket = 'other' then 0.25 else 0 end)
  from members mm
  join public.day_entries e on e.user_id = mm.user_id
  join buckets b on b.category = e.category
  where not mm.is_demo
     or e.date < local_day
     or (e.date = local_day and e.slot <= local_slot)
  group by mm.user_id, mm.name, e.date;
end $$;

-- 6. compare_lifts ---------------------------------------------------------------

create or replace function public.compare_lifts(t uuid)
returns table (member_id uuid, display_name text, date date, exercise text, weight_kg numeric, reps text)
language plpgsql security definer stable set search_path = public as $$
declare
  local_day date;
begin
  if not public.is_track_member(t) then raise exception 'Not a member of this track'; end if;
  local_day := public.viewer_local_ts()::date;

  return query
  select m.user_id, coalesce(p.display_name, 'anonymous'), l.date, l.exercise, l.weight_kg, l.reps
  from public.track_members m
  join public.lift_entries l on l.user_id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.track_id = t and m.share_rule <> 'hidden'
    and (not coalesce(p.is_demo, false) or l.date < local_day);
end $$;

-- 7. supporting index: category is filtered/aggregated on every leaderboard read
create index if not exists day_entries_user_date_slot_idx
  on public.day_entries (user_id, date, slot) include (category);
