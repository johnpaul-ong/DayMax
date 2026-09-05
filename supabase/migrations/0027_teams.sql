-- DayMax migration 27: Teams — Light, Dark and Cottage.
--
-- The team IS the theme. Picking a look at signup enlists you, which is the
-- whole appeal: no extra decision, instant tribe, and every pursuit gets a
-- second scoreboard where it's your lot against the other two.
--
-- No new column: profiles.theme already holds it. The 'ghibli' theme is
-- renamed 'cottage' to match.

alter table public.profiles drop constraint if exists profiles_theme_check;
update public.profiles set theme = 'cottage' where theme = 'ghibli';
update public.profiles set theme = 'light' where theme is null;
alter table public.profiles
  add constraint profiles_theme_check check (theme in ('light', 'dark', 'cottage'));
alter table public.profiles alter column theme set default 'light';

-- the demo cast pick sides
update public.profiles set theme = 'dark'    where id = '11111111-1111-4111-8111-111111111102'; -- Tony
update public.profiles set theme = 'dark'    where id = '11111111-1111-4111-8111-111111111105'; -- Natasha
update public.profiles set theme = 'cottage' where id = '11111111-1111-4111-8111-111111111101'; -- Bruce
update public.profiles set theme = 'light'   where id = '11111111-1111-4111-8111-111111111103'; -- Thor
update public.profiles set theme = 'light'   where id = '11111111-1111-4111-8111-111111111104'; -- Steve
update public.profiles set theme = 'light'   where id = '11111111-1111-4111-8111-111111111106'; -- John

-- Team standings for one pursuit.
--
-- Returns a single shape for every pursuit kind so the UI can render one table:
--   score  — the number teams are ranked on (meaning depends on kind)
--   detail — a human-readable breakdown for that team
--
--   life  : WorkMax per member (focus x productive hours), so a big team can't
--           win by being big
--   lifts : average best lift per member on the pursuit's most-logged exercise
--   custom: average per member of the first visible stat
create or replace function public.pursuit_team_standings(p uuid, from_date date default null, to_date date default null)
returns table (team text, members bigint, score numeric, detail text)
language plpgsql security definer stable set search_path = public as $$
declare
  k text;
  s uuid;
  cad text;
  top_exercise text;
  local_ts timestamp;
  local_day date;
  local_slot int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select pu.kind into k from public.pursuits pu
   where pu.id = p
     and (pu.is_public or pu.owner_id is null or pu.owner_id = auth.uid() or public.is_pursuit_member(pu.id));
  if k is null then raise exception 'You cannot see this pursuit'; end if;

  local_ts := public.viewer_local_ts();
  local_day := local_ts::date;
  local_slot := extract(hour from local_ts)::int * 4 + extract(minute from local_ts)::int / 15;

  if k = 'life' then
    return query
    with mem as (
      select m.user_id, coalesce(pr.theme, 'light') as team, coalesce(pr.is_demo, false) as demo
      from public.pursuit_members m
      left join public.profiles pr on pr.id = m.user_id
      where m.pursuit_id = p
    ),
    per_person as (
      select mm.team,
             mm.user_id,
             sum(case when e.category in (1, 2) then 0.25 else 0 end) as prod,
             sum(case when e.category in (6, 9) then 0.25 else 0 end) as rot
      from mem mm
      join public.day_entries e on e.user_id = mm.user_id
      where (from_date is null or e.date >= from_date)
        and (to_date is null or e.date <= to_date)
        and (not mm.demo
             or e.date < local_day
             or (e.date = local_day and e.slot <= local_slot))
      group by mm.team, mm.user_id
    )
    select pp.team,
           count(*)::bigint,
           round(avg(case when pp.prod + pp.rot > 0 then pp.prod / (pp.prod + pp.rot) * pp.prod else 0 end)::numeric, 1),
           round(sum(pp.prod)::numeric, 0) || 'h productive · ' || round(sum(pp.rot)::numeric, 0) || 'h brainrot'
    from per_person pp
    group by pp.team
    order by 3 desc;

  elsif k = 'lifts' then
    select l.exercise into top_exercise
    from public.pursuit_members m
    join public.lift_entries l on l.user_id = m.user_id
    where m.pursuit_id = p and l.weight_kg is not null
    group by l.exercise order by count(*) desc limit 1;

    if top_exercise is null then return; end if;

    return query
    with per_person as (
      select coalesce(pr.theme, 'light') as team, m.user_id, max(l.weight_kg) as best
      from public.pursuit_members m
      left join public.profiles pr on pr.id = m.user_id
      join public.lift_entries l on l.user_id = m.user_id
      where m.pursuit_id = p and l.exercise = top_exercise and l.weight_kg is not null
        and (from_date is null or l.date >= from_date)
      group by 1, 2
    )
    select pp.team, count(*)::bigint, round(avg(pp.best)::numeric, 1),
           'best ' || round(max(pp.best)::numeric, 1) || 'kg · ' || top_exercise
    from per_person pp group by pp.team order by 3 desc;

  else
    select ps.id, ps.cadence into s, cad
    from public.pursuit_stats ps
    where ps.pursuit_id = p and not coalesce(ps.hidden, false)
    order by ps.created_at limit 1;
    if s is null then return; end if;

    return query
    with per_person as (
      select coalesce(pr.theme, 'light') as team, e.user_id,
             case when cad = 'daily' then sum(e.value) else max(e.value) end as v
      from public.pursuit_entries e
      join public.pursuit_members m on m.pursuit_id = p and m.user_id = e.user_id
      left join public.profiles pr on pr.id = e.user_id
      where e.stat_id = s
        and (from_date is null or e.date >= from_date)
        and (to_date is null or e.date <= to_date)
      group by 1, 2
    )
    select pp.team, count(*)::bigint, round(avg(pp.v)::numeric, 1),
           'total ' || round(sum(pp.v)::numeric, 1) || ' · best ' || round(max(pp.v)::numeric, 1)
    from per_person pp group by pp.team order by 3 desc;
  end if;
end $$;

-- Every team's overall standing, for a leaderboard that isn't pursuit-specific.
create or replace function public.team_totals(from_date date default null, to_date date default null)
returns table (team text, members bigint, work_max numeric, productive numeric, brainrot numeric)
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
  with per_person as (
    select coalesce(pr.theme, 'light') as team, pr.id as uid,
           sum(case when e.category in (1, 2) then 0.25 else 0 end) as prod,
           sum(case when e.category in (6, 9) then 0.25 else 0 end) as rot
    from public.profiles pr
    join public.day_entries e on e.user_id = pr.id
    where (from_date is null or e.date >= from_date)
      and (to_date is null or e.date <= to_date)
      and (not coalesce(pr.is_demo, false)
           or e.date < local_day
           or (e.date = local_day and e.slot <= local_slot))
    group by 1, 2
  )
  select pp.team, count(*)::bigint,
         round(avg(case when pp.prod + pp.rot > 0 then pp.prod / (pp.prod + pp.rot) * pp.prod else 0 end)::numeric, 1),
         round(sum(pp.prod)::numeric, 0),
         round(sum(pp.rot)::numeric, 0)
  from per_person pp group by pp.team order by 3 desc;
end $$;
