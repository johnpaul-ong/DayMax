-- DayMax migration 9: social hours in the Arena + profile day-strips.

-- leaderboard now also returns social hours (own board, NOT part of the score)
drop function if exists public.leaderboard_day_totals();
create function public.leaderboard_day_totals()
returns table (member_id uuid, display_name text, is_demo boolean, date date, productive numeric, brainrot numeric, social numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  return query
  with visible as (
    select p.id, coalesce(p.display_name, 'anonymous') as name, p.is_demo
    from public.profiles p
    where p.is_demo
       or p.id = auth.uid()
       or exists (
         select 1
         from public.track_members a
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
         sum(case when b.bucket = 'social' then 0.25 else 0 end)
  from visible v
  join public.day_entries e on e.user_id = v.id
  join buckets b on b.category = e.category
  group by v.id, v.name, v.is_demo, e.date;
end $$;

-- full 15-minute history for a profile page. Allowed when:
-- it's you, the member is a demo legend, or they share raw_labels on a common track.
create function public.member_day_strip(member uuid)
returns table (date date, slot smallint, category smallint, label text)
language plpgsql security definer stable set search_path = public as $$
begin
  if member <> auth.uid()
     and not exists (select 1 from public.profiles p where p.id = member and p.is_demo)
     and not exists (
       select 1
       from public.track_members a
       join public.track_members b on a.track_id = b.track_id
       where a.user_id = auth.uid() and b.user_id = member and b.share_rule = 'raw_labels'
     ) then
    raise exception 'This person does not share their day detail';
  end if;
  return query
  select e.date, e.slot, e.category, e.label
  from public.day_entries e
  where e.user_id = member
  order by e.date, e.slot;
end $$;
