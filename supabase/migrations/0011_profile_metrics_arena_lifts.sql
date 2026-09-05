-- DayMax migration 11: day metrics on profiles + lifts for the Arena.

-- numeric day metrics (no notes — those stay private) for a profile you may view
create function public.member_day_metrics(member uuid)
returns table (date date, emotional_score numeric, tired numeric, start_friction numeric, end_brain_fatigue numeric, weight_kg numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  if member <> auth.uid()
     and not exists (select 1 from public.profiles p where p.id = member and p.is_demo)
     and not exists (
       select 1
       from public.track_members a
       join public.track_members b on a.track_id = b.track_id
       where a.user_id = auth.uid() and b.user_id = member and b.share_rule <> 'hidden'
     ) then
    raise exception 'You do not share a track with this person';
  end if;
  return query
  select m.date, m.emotional_score, m.tired, m.start_friction, m.end_brain_fatigue, m.weight_kg
  from public.day_metrics m
  where m.user_id = member
  order by m.date;
end $$;

-- lifts for everyone visible in the Arena (demo users + non-hidden co-members)
create function public.leaderboard_lifts()
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
      or exists (
        select 1
        from public.track_members a
        join public.track_members b on a.track_id = b.track_id
        where a.user_id = auth.uid() and b.user_id = p.id and b.share_rule <> 'hidden'
      ));
end $$;
