-- DayMax migration 29: make a pursuit page worth landing on when you're NOT
-- a member yet, plus the Avengers reroute (again) and Judo made public.
--
-- THE PROBLEM, PLAINLY: pursuit_stat_data() requires membership. So a stranger
-- opening /pursuits/<chess> saw a title, a one-line description, and a blank
-- page. There was nothing to be curious about and no reason to join. Every
-- number on the page was behind the door you were being asked to walk through.
--
-- These readers expose AGGREGATES to anyone who can see the pursuit — how many
-- people, how active, what the spread looks like, who's on top — while
-- individual entries stay members-only.

-- 1. Housekeeping --------------------------------------------------------------

-- Judo (and any other user-made pursuit stuck invite-only) becomes public.
update public.pursuits set is_public = true where owner_id is not null;

-- Route the demo cast out of Life/DayMax and into their own pursuit. Repeated
-- from 0026/0028 because it clearly hasn't taken — run the verification at the
-- bottom of this file to confirm it did this time.
delete from public.pursuit_members
 where pursuit_id in ('33333333-3333-4333-8333-333333333301',
                      '33333333-3333-4333-8333-333333333303')
   and user_id in (select id from public.profiles where is_demo = true);

insert into public.pursuit_members (pursuit_id, user_id, role)
select '33333333-3333-4333-8333-333333333304'::uuid, p.id, 'member'
from public.profiles p
where p.is_demo = true
on conflict (pursuit_id, user_id) do nothing;


-- 2. Preview readers -----------------------------------------------------------

create or replace function public.can_see_pursuit(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.pursuits pu
    where pu.id = p
      and (pu.is_public or pu.owner_id is null or pu.owner_id = auth.uid() or public.is_pursuit_member(pu.id))
  );
$$;

-- Per-stat headline numbers. No individual values, so it's safe for strangers.
create or replace function public.pursuit_stat_summary(p uuid)
returns table (stat_id uuid, name text, unit text, cadence text, direction text,
               participants bigint, entries bigint, avg_value numeric,
               best_value numeric, last_logged date)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.can_see_pursuit(p) then raise exception 'You cannot see this pursuit'; end if;
  return query
  select s.id, s.name, s.unit, s.cadence, s.direction,
         count(distinct e.user_id),
         count(e.*),
         round(avg(e.value)::numeric, 1),
         case when s.direction = 'less' then min(e.value) else max(e.value) end,
         max(e.date)
  from public.pursuit_stats s
  left join public.pursuit_entries e on e.stat_id = s.id
  where s.pursuit_id = p and not coalesce(s.hidden, false)
  group by s.id, s.name, s.unit, s.cadence, s.direction
  order by s.created_at;
end $$;

-- Is this thing alive? Entries and active people per week.
create or replace function public.pursuit_activity(p uuid, weeks int default 12)
returns table (week_start date, entries bigint, active_members bigint)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.can_see_pursuit(p) then raise exception 'You cannot see this pursuit'; end if;
  return query
  select date_trunc('week', e.date)::date, count(*), count(distinct e.user_id)
  from public.pursuit_entries e
  join public.pursuit_stats s on s.id = e.stat_id
  where s.pursuit_id = p
    and e.date >= (current_date - (weeks * 7))
  group by 1 order by 1;
end $$;

-- Where would I land? Each member's average for a stat, bucketed — so you can
-- see the spread without seeing anybody's actual numbers.
create or replace function public.pursuit_stat_spread(s uuid, buckets int default 8)
returns table (bucket_low numeric, bucket_high numeric, members bigint)
language plpgsql security definer stable set search_path = public as $$
declare
  p uuid;
  lo numeric;
  hi numeric;
  step numeric;
begin
  select ps.pursuit_id into p from public.pursuit_stats ps where ps.id = s;
  if p is null or not public.can_see_pursuit(p) then raise exception 'You cannot see this pursuit'; end if;

  create temp table if not exists _spread (uid uuid, v numeric) on commit drop;
  delete from _spread;
  insert into _spread
  select e.user_id, avg(e.value) from public.pursuit_entries e where e.stat_id = s group by e.user_id;

  select min(v), max(v) into lo, hi from _spread;
  if lo is null then return; end if;
  if hi = lo then hi := lo + 1; end if;
  step := (hi - lo) / buckets;

  return query
  select round((lo + step * g)::numeric, 1),
         round((lo + step * (g + 1))::numeric, 1),
         (select count(*) from _spread sp
           where sp.v >= lo + step * g
             and (sp.v < lo + step * (g + 1) or g = buckets - 1))
  from generate_series(0, buckets - 1) g;
end $$;

-- The top few, visible to non-members: names and a score, nothing granular.
create or replace function public.pursuit_stat_top(s uuid, n int default 5)
returns table (member_id uuid, display_name text, username text, score numeric, entries bigint)
language plpgsql security definer stable set search_path = public as $$
declare
  p uuid;
  cad text;
  dir text;
begin
  select ps.pursuit_id, ps.cadence, ps.direction into p, cad, dir
  from public.pursuit_stats ps where ps.id = s;
  if p is null or not public.can_see_pursuit(p) then raise exception 'You cannot see this pursuit'; end if;

  return query
  select e.user_id,
         coalesce(pr.display_name, 'anonymous'),
         pr.username,
         case when cad = 'daily' then round(sum(e.value)::numeric, 1)
              else round(max(e.value)::numeric, 1) end,
         count(*)
  from public.pursuit_entries e
  left join public.profiles pr on pr.id = e.user_id
  where e.stat_id = s
  group by e.user_id, pr.display_name, pr.username
  order by 4 desc
  limit n;
end $$;


-- 3. VERIFY — all three should be true after this runs -------------------------
--
-- select
--   (select count(*) from public.pursuit_members m
--      join public.profiles p on p.id = m.user_id
--     where m.pursuit_id = '33333333-3333-4333-8333-333333333301' and p.is_demo) = 0
--     as no_avengers_in_life,
--   (select count(*) from public.pursuit_members
--     where pursuit_id = '33333333-3333-4333-8333-333333333304') = 6
--     as six_in_avengers_pursuit,
--   (select bool_and(is_public) from public.pursuits where owner_id is not null)
--     as all_user_pursuits_public;
