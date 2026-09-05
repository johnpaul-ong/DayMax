-- DayMax migration 26: the Avengers get their own Life pursuit.
--
-- They were sitting in the everyone-pursuit, which meant a new user's Life
-- board was topped by a Norse god and a man in a powered exoskeleton. Now
-- "Life — Avengers Assemble" is a separate public pursuit you can look at
-- (and join) deliberately, and plain Life is just the people in it.
--
-- To make that work, the Life-style community board had to stop meaning
-- "every demo user" and start meaning "the members of THIS pursuit".

insert into public.pursuits (id, owner_id, name, description, kind, is_public) values
  ('33333333-3333-4333-8333-333333333304', null, 'Life — Avengers Assemble',
   'A year in the life of Earth''s mightiest. Here to show what a full year of 15-minute logging looks like.',
   'life', true)
on conflict (id) do nothing;

-- move the demo cast out of Life and into their own
delete from public.pursuit_members
 where pursuit_id = '33333333-3333-4333-8333-333333333301'
   and user_id in (select id from public.profiles where is_demo);

insert into public.pursuit_members (pursuit_id, user_id, role)
select '33333333-3333-4333-8333-333333333304'::uuid, p.id, 'member'
from public.profiles p where p.is_demo
on conflict do nothing;

-- ...and out of the DayMax pursuit too; they don't rate their days out of 10
delete from public.pursuit_members
 where pursuit_id = '33333333-3333-4333-8333-333333333303'
   and user_id in (select id from public.profiles where is_demo);

-- Day totals for the members of ONE pursuit, gated the same way profiles are.
-- This is what a Life-style community board reads.
create or replace function public.pursuit_day_totals(p uuid, from_date date default null, to_date date default null)
returns table (member_id uuid, display_name text, is_demo boolean, date date,
               productive numeric, brainrot numeric, social numeric, other numeric)
language plpgsql security definer stable set search_path = public as $$
declare
  local_ts timestamp;
  local_day date;
  local_slot int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (
    select 1 from public.pursuits pu
    where pu.id = p
      and (pu.is_public or pu.owner_id is null or pu.owner_id = auth.uid() or public.is_pursuit_member(pu.id))
  ) then
    raise exception 'You cannot see this pursuit';
  end if;

  local_ts := public.viewer_local_ts();
  local_day := local_ts::date;
  local_slot := extract(hour from local_ts)::int * 4 + extract(minute from local_ts)::int / 15;

  return query
  with members as (
    select m.user_id,
           coalesce(pr.display_name, 'anonymous') as name,
           coalesce(pr.is_demo, false) as demo
    from public.pursuit_members m
    left join public.profiles pr on pr.id = m.user_id
    where m.pursuit_id = p
      -- you see yourself, the legends, and anyone whose page you could open
      and (m.user_id = auth.uid() or coalesce(pr.is_demo, false) or public.can_view_profile(m.user_id))
  )
  select mm.user_id, mm.name, mm.demo, e.date,
         sum(case when e.category in (1, 2) then 0.25 else 0 end),
         sum(case when e.category in (6, 9) then 0.25 else 0 end),
         sum(case when e.category = 3 then 0.25 else 0 end),
         sum(case when e.category not in (1, 2, 3, 6, 9) then 0.25 else 0 end)
  from members mm
  join public.day_entries e on e.user_id = mm.user_id
  where (from_date is null or e.date >= from_date)
    and (to_date is null or e.date <= to_date)
    and (not mm.demo
         or e.date < local_day
         or (e.date = local_day and e.slot <= local_slot))
  group by mm.user_id, mm.name, mm.demo, e.date;
end $$;

-- Same idea for the Lifts board.
create or replace function public.pursuit_lift_rows(p uuid, from_date date default null)
returns table (member_id uuid, display_name text, date date, exercise text, weight_kg numeric)
language plpgsql security definer stable set search_path = public as $$
declare
  local_day date;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (
    select 1 from public.pursuits pu
    where pu.id = p
      and (pu.is_public or pu.owner_id is null or pu.owner_id = auth.uid() or public.is_pursuit_member(pu.id))
  ) then
    raise exception 'You cannot see this pursuit';
  end if;

  local_day := public.viewer_local_ts()::date;

  return query
  select m.user_id, coalesce(pr.display_name, 'anonymous'), l.date, l.exercise, l.weight_kg
  from public.pursuit_members m
  left join public.profiles pr on pr.id = m.user_id
  join public.lift_entries l on l.user_id = m.user_id
  where m.pursuit_id = p
    and l.weight_kg is not null
    and (from_date is null or l.date >= from_date)
    and (m.user_id = auth.uid() or coalesce(pr.is_demo, false) or public.can_view_profile(m.user_id))
    and (not coalesce(pr.is_demo, false) or l.date < local_day);
end $$;

-- Roster suppression now applies to the ONE everyone-pursuit, by id, rather
-- than to every pursuit of kind 'life' — the Avengers one is a normal group
-- and showing its six members is the entire point.
create or replace function public.pursuit_member_list(p uuid)
returns table (member_id uuid, display_name text, username text, role text, is_demo boolean, is_visible boolean)
language plpgsql security definer stable set search_path = public as $$
declare
  k text;
  can_see boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  select pu.kind,
         (pu.is_public or pu.owner_id is null or pu.owner_id = auth.uid() or public.is_pursuit_member(pu.id))
    into k, can_see
  from public.pursuits pu where pu.id = p;

  if k is null then raise exception 'No such pursuit'; end if;
  if not can_see then raise exception 'You cannot see this pursuit'; end if;

  -- the everyone-pursuit has no roster: it would be a directory of every account
  if p = '33333333-3333-4333-8333-333333333301'::uuid then return; end if;

  return query
  select m.user_id,
         coalesce(pr.display_name, 'anonymous'),
         pr.username,
         m.role,
         coalesce(pr.is_demo, false),
         public.can_view_profile(m.user_id)
  from public.pursuit_members m
  left join public.profiles pr on pr.id = m.user_id
  where m.pursuit_id = p
    and (k <> 'life' or public.is_connected(m.user_id) or coalesce(pr.is_public, false))
  order by (m.role = 'owner') desc, coalesce(pr.display_name, 'anonymous');
end $$;
