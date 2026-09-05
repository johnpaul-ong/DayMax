-- DayMax migration 21: real, chosen usernames + discoverable on by default.
--
-- Until now "username" was just split_part(email, '@', 1) computed on the fly —
-- you couldn't change it, and it leaked the local part of your email address to
-- anyone who could see your profile. Now it's a stored, unique, chosen handle.
--
-- New accounts get a provisional handle immediately (so nothing is ever null)
-- with username_chosen = false, which is what the /welcome page looks for.

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists username_chosen boolean not null default false;

-- Discoverable by default. Minors are still filtered out of search_profiles
-- unconditionally, so this does not expose them.
alter table public.profiles alter column discoverable set default true;

-- squeeze any string into a legal handle: 3-20 chars of [a-z0-9_]
create or replace function public.normalize_username(raw text)
returns text language sql immutable as $$
  select left(
    case when length(regexp_replace(lower(coalesce(raw, '')), '[^a-z0-9_]', '_', 'g')) < 3
         then rpad(nullif(regexp_replace(lower(coalesce(raw, '')), '[^a-z0-9_]', '_', 'g'), ''), 3, '0')
         else regexp_replace(lower(coalesce(raw, '')), '[^a-z0-9_]', '_', 'g')
    end, 20);
$$;

-- backfill existing accounts from their email prefix, de-duplicated
do $$
declare
  rec record;
  base text;
  candidate text;
  n int;
begin
  for rec in
    select p.id, u.email
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.username is null
    order by u.created_at
  loop
    base := public.normalize_username(split_part(rec.email, '@', 1));
    candidate := base;
    n := 1;
    while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
      n := n + 1;
      candidate := left(base, 20 - length(n::text)) || n::text;
    end loop;
    -- existing accounts are marked as already-chosen: the /welcome step is for
    -- NEW signups only, not an interruption for people already using the app
    update public.profiles set username = candidate, username_chosen = true where id = rec.id;
  end loop;
end $$;

-- existing adults become discoverable; minors and demo accounts are left alone
update public.profiles p
   set discoverable = true
 where coalesce(p.is_demo, false) = false
   and not public.is_minor(p.id);

create unique index if not exists profiles_username_key on public.profiles (lower(username));

-- is this handle free? (also false when it's malformed or reserved)
create or replace function public.username_available(u text)
returns boolean language sql security definer stable set search_path = public as $$
  select public.normalize_username(u) = lower(u)
     and length(u) between 3 and 20
     and u !~ '^(admin|root|daymax|support|help|about|settings|api|null)$'
     and not exists (
       select 1 from public.profiles p
       where lower(p.username) = lower(u) and p.id <> auth.uid()
     );
$$;

-- claim a handle. Marks the account as having chosen one, which dismisses
-- the welcome step for good.
create or replace function public.set_username(u text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if length(coalesce(u, '')) < 3 or length(u) > 20 then
    raise exception 'Usernames are 3-20 characters';
  end if;
  if public.normalize_username(u) <> lower(u) then
    raise exception 'Usernames can only use letters, numbers and underscores';
  end if;
  if not public.username_available(u) then
    raise exception 'That username is taken';
  end if;
  update public.profiles
     set username = lower(u), username_chosen = true
   where id = auth.uid();
end $$;

-- new accounts: provisional handle now, real one at /welcome
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text;
  candidate text;
  n int := 1;
begin
  base := public.normalize_username(split_part(new.email, '@', 1));
  candidate := base;
  while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
    n := n + 1;
    candidate := left(base, 20 - length(n::text)) || n::text;
  end loop;

  insert into public.profiles (id, display_name, username, username_chosen, discoverable)
  values (new.id, split_part(new.email, '@', 1), candidate, false, true);

  insert into public.pursuit_members (pursuit_id, user_id, role)
  values ('33333333-3333-4333-8333-333333333301', new.id, 'member')
  on conflict do nothing;
  return new;
end $$;

-- readers switch from the email prefix to the stored handle -------------------

create or replace function public.search_profiles(q text)
returns table (member_id uuid, display_name text, username text)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  return query
  select p.id, coalesce(p.display_name, 'anonymous'), p.username
  from public.profiles p
  where p.discoverable
    and not p.is_demo
    and not public.is_minor(p.id)
    and p.id <> auth.uid()
    and (p.display_name ilike '%' || q || '%' or p.username ilike '%' || q || '%')
  limit 20;
end $$;

create or replace function public.list_friends()
returns table (friendship_id bigint, member_id uuid, display_name text, username text, status text, direction text)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  return query
  select f.id,
         case when f.requester = auth.uid() then f.addressee else f.requester end,
         coalesce(p.display_name, 'anonymous'),
         p.username,
         f.status,
         case when f.requester = auth.uid() then 'outgoing' else 'incoming' end
  from public.friendships f
  join public.profiles p on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
  where f.requester = auth.uid() or f.addressee = auth.uid()
  order by f.created_at desc;
end $$;

create or replace function public.member_profile(member uuid)
returns table (display_name text, username text, sections jsonb)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_connected(member) then
    raise exception 'You are not connected with this person';
  end if;
  return query
  select coalesce(p.display_name, 'anonymous'),
         p.username,
         coalesce(p.profile_sections, '["ranking","hours","lifts"]'::jsonb)
  from public.profiles p
  where p.id = member;
end $$;

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

  -- LIFE HAS NO ROSTER. Every account on the platform is auto-joined to Life,
  -- so listing its members would turn it into a directory of every user —
  -- exactly what the consent-first model is meant to prevent. Life is for
  -- absolutely everyone, and precisely because of that, nobody is listed.
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
  where (k = 'custom' or public.is_connected(m.user_id))
    and (not public.is_minor(m.user_id) or public.is_connected(m.user_id))
  order by (m.role = 'owner') desc, coalesce(pr.display_name, 'anonymous');
end $$;

-- the demo cast get their in-character handles, already chosen
update public.profiles set username = 'hulk',          username_chosen = true where id = '11111111-1111-4111-8111-111111111101';
update public.profiles set username = 'tony',          username_chosen = true where id = '11111111-1111-4111-8111-111111111102';
update public.profiles set username = 'thor',          username_chosen = true where id = '11111111-1111-4111-8111-111111111103';
update public.profiles set username = 'captainamerica', username_chosen = true where id = '11111111-1111-4111-8111-111111111104';
update public.profiles set username = 'blackwidow',    username_chosen = true where id = '11111111-1111-4111-8111-111111111105';
update public.profiles set username = 'johndoe',       username_chosen = true where id = '11111111-1111-4111-8111-111111111106';
