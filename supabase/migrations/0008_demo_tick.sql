-- DayMax migration 8: the legends live forever.
-- Every midnight (UTC) each demo user's "today" is filled in by replaying one
-- of their own past days with the same weekday — so Steve still runs at 5am,
-- Thor still feasts, and Hulk incidents keep happening at the same rate.

-- copy one demo user's day (entries, metrics, lifts, bodyweight) src -> dst
create function public.demo_copy_day(u uuid, src date, dst date)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.day_entries (user_id, date, slot, category, label)
  select user_id, dst, slot, category, label from public.day_entries
  where user_id = u and date = src
  on conflict (user_id, date, slot) do nothing;

  insert into public.day_metrics (user_id, date, emotional_score, tired, start_friction, end_brain_fatigue, deep_time, weight_kg, notes)
  select user_id, dst, emotional_score, tired, start_friction, end_brain_fatigue, deep_time, weight_kg, notes
  from public.day_metrics where user_id = u and date = src
  on conflict (user_id, date) do nothing;

  insert into public.lift_entries (user_id, date, exercise, weight_kg, reps, notes)
  select user_id, dst, exercise, weight_kg, reps, notes
  from public.lift_entries where user_id = u and date = src;

  insert into public.daily_metrics (user_id, date, metric, value, text_value)
  select user_id, dst, metric, value, text_value
  from public.daily_metrics where user_id = u and date = src
  on conflict (user_id, date, metric) do nothing;
end $$;

-- fill every missing day up to today for all demo users
create function public.demo_fill_to_today()
returns void language plpgsql security definer set search_path = public as $$
declare u record; d date; src date;
begin
  for u in select p.id from public.profiles p where p.is_demo loop
    select coalesce(max(e.date), current_date - 1) into d from public.day_entries e where e.user_id = u.id;
    d := d + 1;
    while d <= current_date loop
      -- a random past day of the same weekday, from their own history
      select e.date into src from public.day_entries e
      where e.user_id = u.id and e.date < d
        and extract(dow from e.date) = extract(dow from d)
      group by e.date
      order by md5(e.date::text || d::text)  -- deterministic-ish shuffle
      limit 1;
      if src is not null then
        perform public.demo_copy_day(u.id, src, d);
      end if;
      d := d + 1;
    end loop;
  end loop;
end $$;

-- schedule nightly at 00:05 UTC (pg_cron ships with Supabase; harmless if already scheduled)
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('daymax-demo-tick', '5 0 * * *', 'select public.demo_fill_to_today()');
exception when others then
  raise notice 'pg_cron not available — run "select public.demo_fill_to_today();" manually or via a scheduled job. (%)', sqlerrm;
end $$;
