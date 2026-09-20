-- DayMax migration 39: last-logged on the pursuit member list.
--
-- The list currently shows who is IN a pursuit but not who's ACTIVE. On a
-- board with ghost members you want to see "logged today" vs "hasn't been
-- back in 3 weeks" at a glance.
--
-- Adds `last_logged date` to pursuit_member_list()'s output. The value is
-- MAX(date) across the person's activity relevant to the pursuit KIND:
--   life    -> day_entries
--   lifts   -> lift_entries
--   custom  -> pursuit_entries for any stat under this pursuit
--   money   -> spend_entries (money is a custom pursuit but has its own table)
--
-- If a person has never logged anything for this pursuit it's NULL, and the
-- client can render "never" without a special sentinel.

drop function if exists public.pursuit_member_list(uuid);
drop function if exists public.pursuit_member_list(uuid, int);

create function public.pursuit_member_list(p uuid, limit_n int default 500)
returns table (
  member_id uuid,
  display_name text,
  username text,
  role text,
  is_demo boolean,
  is_visible boolean,
  team text,
  last_logged date
)
language plpgsql security definer stable set search_path = public as $$
declare
  can_see boolean;
  pkind text;
  pid uuid := p;
  money_id constant uuid := '33333333-3333-4333-8333-333333333305';
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  select pu.kind, (pu.is_public or pu.owner_id is null or pu.owner_id = auth.uid() or public.is_pursuit_member(pu.id))
    into pkind, can_see
  from public.pursuits pu where pu.id = pid;

  if can_see is null then raise exception 'No such pursuit'; end if;
  if not can_see then raise exception 'You cannot see this pursuit'; end if;

  return query
  select m.user_id,
         coalesce(pr.display_name, 'anonymous'),
         pr.username,
         m.role,
         coalesce(pr.is_demo, false),
         public.can_view_profile(m.user_id),
         coalesce(pr.theme, 'light'),
         -- one CASE per kind, so we never scan a table that isn't relevant
         case
           when pkind = 'life'
             then (select max(e.date) from public.day_entries e where e.user_id = m.user_id)
           when pkind = 'lifts'
             then (select max(l.date) from public.lift_entries l where l.user_id = m.user_id)
           when pid = money_id
             then (select max(s.date) from public.spend_entries s where s.user_id = m.user_id)
           when pkind = 'custom'
             then (
               select max(pe.date)
                 from public.pursuit_entries pe
                 join public.pursuit_stats ps on ps.id = pe.stat_id
                where ps.pursuit_id = pid and pe.user_id = m.user_id
             )
         end as last_logged
  from public.pursuit_members m
  left join public.profiles pr on pr.id = m.user_id
  where m.pursuit_id = pid
  order by (m.role = 'owner') desc, coalesce(pr.display_name, 'anonymous')
  limit least(greatest(coalesce(limit_n, 500), 1), 2000);
end $$;
