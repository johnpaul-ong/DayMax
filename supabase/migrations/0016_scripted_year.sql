-- DayMax migration 16: the demo universe is scripted through Dec 31 and
-- REVEALED progressively — every read of demo data is time-gated to "now",
-- so the legends' day fills in live all day long. Replaces the copy-forward
-- cron jobs (unscheduled below). Also trims the Life pursuit description.

update public.pursuits set description = 'The whole point.' where kind = 'life';

-- is this demo row visible yet? (non-demo users: always)
create function public.demo_row_visible(u uuid, d date, s smallint)
returns boolean language sql security definer stable set search_path = public as $$
  select not exists (select 1 from public.profiles p where p.id = u and p.is_demo)
      or d < current_date
      or (d = current_date and s <= (extract(hour from now())::int * 4 + extract(minute from now())::int / 15));
$$;

create function public.demo_date_visible(u uuid, d date)
returns boolean language sql security definer stable set search_path = public as $$
  select not exists (select 1 from public.profiles p where p.id = u and p.is_demo)
      or d < current_date;
$$;

-- stop the old copy-forward jobs (functions stay, harmlessly unused)
do $$
begin
  perform cron.unschedule('daymax-demo-tick');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('daymax-demo-live');
exception when others then null;
end $$;

-- recreate every reader with the gate ------------------------------------------

create or replace function public.compare_day_totals(t uuid)
returns table (member_id uuid, display_name text, date date, productive numeric, brainrot numeric, other numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_track_member(t) then raise exception 'Not a member of this track'; end if;
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
  )
  select m.user_id, coalesce(p.display_name, 'anonymous'), e.date,
         sum(case when b.bucket = 'productive' then 0.25 else 0 end),
         sum(case when b.bucket = 'brainrot' then 0.25 else 0 end),
         sum(case when b.bucket = 'other' then 0.25 else 0 end)
  from public.track_members m
  join public.day_entries e on e.user_id = m.user_id
  join buckets b on b.category = e.category
  left join public.profiles p on p.id = m.user_id
  where m.track_id = t and m.share_rule <> 'hidden'
    and public.demo_row_visible(e.user_id, e.date, e.slot)
  group by m.user_id, p.display_name, e.date;
end $$;

create or replace function public.member_day_strip(member uuid)
returns table (date date, slot smallint, category smallint, label text)
language plpgsql security definer stable set search_path = public as $$
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
  return query
  select e.date, e.slot, e.category, e.label
  from public.day_entries e
  where e.user_id = member and public.demo_row_visible(member, e.date, e.slot)
  order by e.date, e.slot;
end $$;

create or replace function public.compare_raw_day(t uuid, member uuid, day date)
returns table (slot smallint, category smallint, label text)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_track_member(t) then raise exception 'Not a member of this track'; end if;
  if not exists (
    select 1 from public.track_members m
    where m.track_id = t and m.user_id = member and m.share_rule = 'raw_labels'
  ) then
    raise exception 'This member does not share raw labels';
  end if;
  return query
  select e.slot, e.category, e.label from public.day_entries e
  where e.user_id = member and e.date = day and public.demo_row_visible(member, e.date, e.slot)
  order by e.slot;
end $$;

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
  where public.demo_row_visible(e.user_id, e.date, e.slot)
  group by v.id, v.name, v.is_demo, e.date;
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
  where m.user_id = member and public.demo_date_visible(member, m.date)
  order by m.date;
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
    and public.demo_date_visible(p.id, l.date)
    and (p.is_demo
      or p.id = auth.uid()
      or public.are_friends(auth.uid(), p.id)
      or exists (
        select 1 from public.track_members a
        join public.track_members b on a.track_id = b.track_id
        where a.user_id = auth.uid() and b.user_id = p.id and b.share_rule <> 'hidden'
      ));
end $$;

create or replace function public.compare_lifts(t uuid)
returns table (member_id uuid, display_name text, date date, exercise text, weight_kg numeric, reps text)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_track_member(t) then raise exception 'Not a member of this track'; end if;
  return query
  select m.user_id, coalesce(p.display_name, 'anonymous'), l.date, l.exercise, l.weight_kg, l.reps
  from public.track_members m
  join public.lift_entries l on l.user_id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.track_id = t and m.share_rule <> 'hidden'
    and public.demo_date_visible(m.user_id, l.date);
end $$;
