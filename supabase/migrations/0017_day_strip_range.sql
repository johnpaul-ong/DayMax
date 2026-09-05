-- DayMax migration 17: let member_day_strip take an optional date range so
-- callers that only need a window (Side by side's day view) don't have to
-- page through an entire year of 15-minute rows per person. Profile view
-- keeps calling it with no range (needs the full year for the heatmap).
--
-- Both signatures are dropped first so this is safe to run more than once:
-- Postgres refuses to create f(uuid, date default, date default) while f(uuid)
-- exists (the one-argument call would be ambiguous), and equally refuses to
-- re-create the three-argument form over itself.

drop function if exists public.member_day_strip(uuid);
drop function if exists public.member_day_strip(uuid, date, date);

create function public.member_day_strip(member uuid, from_date date default null, to_date date default null)
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
  where e.user_id = member
    and (from_date is null or e.date >= from_date)
    and (to_date is null or e.date <= to_date)
    and public.demo_row_visible(member, e.date, e.slot)
  order by e.date, e.slot;
end $$;
