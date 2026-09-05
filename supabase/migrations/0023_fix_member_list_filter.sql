-- DayMax migration 23: pursuit_member_list forgot to filter by pursuit.
--
-- THE BUG: the function took `p uuid`, used it to check permissions, and then
-- selected from pursuit_members WITHOUT `where m.pursuit_id = p`. So every
-- pursuit listed every membership row in the whole table.
--
-- That is the real cause of both things that looked like data corruption:
--   * "Chess: 1 member" listing all the Avengers — the count came from
--     pursuit_directory (correct), the list came from here (everything).
--   * "three @jpong accounts" — NOT three accounts. One account with three
--     membership rows: Life, Lifts and Chess. auth.users had a single jpong
--     all along.
--
-- Nothing needs deleting. One line of SQL was missing.

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

  -- Life has no roster: everyone is auto-joined, so listing it would be a
  -- directory of every account on the platform.
  if k = 'life' then
    return;
  end if;

  return query
  select m.user_id,
         coalesce(pr.display_name, 'anonymous'),
         pr.username,
         m.role,
         coalesce(pr.is_demo, false),
         public.is_connected(m.user_id)
  from public.pursuit_members m
  left join public.profiles pr on pr.id = m.user_id
  where m.pursuit_id = p                                   -- <<< the missing line
    and (k = 'custom' or public.is_connected(m.user_id))
    and (not public.is_minor(m.user_id) or public.is_connected(m.user_id))
  order by (m.role = 'owner') desc, coalesce(pr.display_name, 'anonymous');
end $$;

-- Sanity check — run this after applying. Every row's `listed` must equal
-- `actual_members`, and no pursuit should list more people than it has.
--   select * from public.pursuit_member_audit();
create or replace function public.pursuit_member_audit()
returns table (pursuit text, kind text, actual_members bigint, listed bigint)
language sql security definer stable set search_path = public as $$
  select pu.name,
         pu.kind,
         (select count(*) from public.pursuit_members m where m.pursuit_id = pu.id),
         (select count(*) from public.pursuit_member_list(pu.id))
  from public.pursuits pu
  where pu.is_public or pu.owner_id is null or pu.owner_id = auth.uid() or public.is_pursuit_member(pu.id)
  order by pu.name;
$$;
