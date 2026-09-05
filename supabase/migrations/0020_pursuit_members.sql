-- DayMax migration 20: see who else is in a pursuit, and open their profile.
--
-- Two pieces:
--   1. Joining a CUSTOM pursuit together counts as a connection, the same way
--      sharing a track does — otherwise you can see someone on the roster but
--      member_profile() slams the door when you click them. Built-in pursuits
--      (Life, Lifts) deliberately do NOT count: everyone is auto-joined to
--      Life, so counting it would make every user connected to every other.
--   2. pursuit_member_list(p): the roster itself.

create or replace function public.is_connected(member uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select member = auth.uid()
      or exists (select 1 from public.profiles p where p.id = member and p.is_demo)
      or public.are_friends(auth.uid(), member)
      or exists (
        select 1 from public.track_members a
        join public.track_members b on a.track_id = b.track_id
        where a.user_id = auth.uid() and b.user_id = member
      )
      or exists (
        select 1
        from public.pursuit_members a
        join public.pursuit_members b on b.pursuit_id = a.pursuit_id
        join public.pursuits p on p.id = a.pursuit_id
        where a.user_id = auth.uid()
          and b.user_id = member
          and p.kind = 'custom'
      );
$$;

-- The roster.
--   * You must be able to see the pursuit at all (public, built-in, yours, or
--     you're a member).
--   * Built-in pursuits list only people you can already see — Life contains
--     every account on the platform, and that is not a directory.
--   * Minors are only listed to people already connected to them.
--   * `is_visible` tells the UI whether the name should link to a profile.
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

  return query
  select m.user_id,
         coalesce(pr.display_name, 'anonymous'),
         split_part(u.email, '@', 1),
         m.role,
         coalesce(pr.is_demo, false),
         public.is_connected(m.user_id)
  from public.pursuit_members m
  left join public.profiles pr on pr.id = m.user_id
  join auth.users u on u.id = m.user_id
  where m.pursuit_id = p
    and (k = 'custom' or public.is_connected(m.user_id))
    and (not public.is_minor(m.user_id) or public.is_connected(m.user_id))
  order by (m.role = 'owner') desc, coalesce(pr.display_name, 'anonymous');
end $$;
