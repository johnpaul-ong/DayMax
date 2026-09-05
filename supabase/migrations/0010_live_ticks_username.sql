-- DayMax migration 10: usernames on profiles + the legends update LIVE.
-- Their "today" now fills in progressively every 2 hours instead of appearing
-- all at once at midnight — like they're actually logging as they go.

-- profiles gain a username (email local-part), shown as @username
drop function if exists public.member_profile(uuid);
create function public.member_profile(member uuid)
returns table (display_name text, username text, sections jsonb)
language plpgsql security definer stable set search_path = public as $$
begin
  if member <> auth.uid()
     and not exists (select 1 from public.profiles p where p.id = member and p.is_demo)
     and not exists (
       select 1
       from public.track_members a
       join public.track_members b on a.track_id = b.track_id
       where a.user_id = auth.uid() and b.user_id = member
     ) then
    raise exception 'You do not share a track with this person';
  end if;
  return query
  select coalesce(p.display_name, 'anonymous'),
         split_part(u.email, '@', 1),
         coalesce(p.profile_sections, '["ranking","hours","lifts"]'::jsonb)
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = member;
end $$;

-- deterministic source day for replaying: same weekday, from their own history
create function public.demo_pick_source(u uuid, d date)
returns date language sql security definer stable set search_path = public as $$
  select e.date from public.day_entries e
  where e.user_id = u and e.date < d
    and extract(dow from e.date) = extract(dow from d)
  group by e.date
  order by md5(e.date::text || d::text)
  limit 1;
$$;

-- complete days: fill everything up to YESTERDAY (day_metrics = completeness marker)
create or replace function public.demo_fill_to_today()
returns void language plpgsql security definer set search_path = public as $$
declare u record; d date; src date;
begin
  for u in select p.id from public.profiles p where p.is_demo loop
    select coalesce(max(m.date), current_date - 2) + 1 into d from public.day_metrics m where m.user_id = u.id;
    while d <= current_date - 1 loop
      src := public.demo_pick_source(u.id, d);
      if src is not null then
        perform public.demo_copy_day(u.id, src, d);
      end if;
      d := d + 1;
    end loop;
  end loop;
end $$;

-- live: fill TODAY's slots only up to the current time (UTC), every couple of hours
create function public.demo_intraday_tick()
returns void language plpgsql security definer set search_path = public as $$
declare u record; src date; cutoff int;
begin
  cutoff := extract(hour from now())::int * 4 + extract(minute from now())::int / 15;
  for u in select p.id from public.profiles p where p.is_demo loop
    src := public.demo_pick_source(u.id, current_date);
    if src is not null then
      insert into public.day_entries (user_id, date, slot, category, label)
      select user_id, current_date, slot, category, label
      from public.day_entries
      where user_id = u.id and date = src and slot <= cutoff
      on conflict (user_id, date, slot) do nothing;
    end if;
  end loop;
end $$;

-- schedules: nightly completion + 2-hourly live fill
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('daymax-demo-tick');
exception when others then null;
end $$;
do $$
begin
  perform cron.schedule('daymax-demo-tick', '5 0 * * *', 'select public.demo_fill_to_today()');
  perform cron.schedule('daymax-demo-live', '10 */2 * * *', 'select public.demo_intraday_tick()');
exception when others then
  raise notice 'pg_cron not available — schedule demo_fill_to_today (daily) and demo_intraday_tick (2-hourly) another way. (%)', sqlerrm;
end $$;

-- catch up right now
select public.demo_fill_to_today();
select public.demo_intraday_tick();
