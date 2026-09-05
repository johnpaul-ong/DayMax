-- DayMax migration 13: PURSUITS — the unifying concept.
-- Life is the built-in pursuit everyone belongs to. Lifts is built-in (routes
-- to the lift tracker). Users create their own (Chess, Words, ...) with
-- flexible Stats: daily targets or log-whenever ratings, each with a unit and
-- direction, every entry with an optional note. Invite-only by default;
-- public pursuits appear in Explore and must have unique names.

create table public.pursuits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete cascade, -- null = DayMax built-in
  name text not null,
  description text not null default '',
  kind text not null default 'custom' check (kind in ('life', 'lifts', 'custom')),
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);
-- no two PUBLIC pursuits share a name (case-insensitive)
create unique index pursuits_public_name_idx on public.pursuits (lower(name)) where is_public;
alter table public.pursuits enable row level security;

create table public.pursuit_members (
  pursuit_id uuid not null references public.pursuits (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  show_on_profile boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (pursuit_id, user_id)
);
alter table public.pursuit_members enable row level security;

create function public.is_pursuit_member(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.pursuit_members m where m.pursuit_id = p and m.user_id = auth.uid());
$$;

create policy "visible pursuits" on public.pursuits
  for select using (is_public or owner_id is null or owner_id = auth.uid() or public.is_pursuit_member(id));
create policy "create own pursuit" on public.pursuits
  for insert with check (owner_id = auth.uid() and kind = 'custom');
create policy "owner updates pursuit" on public.pursuits
  for update using (owner_id = auth.uid());
create policy "owner deletes pursuit" on public.pursuits
  for delete using (owner_id = auth.uid());

create policy "members visible to fellow members or on public pursuits" on public.pursuit_members
  for select using (
    public.is_pursuit_member(pursuit_id)
    or exists (select 1 from public.pursuits p where p.id = pursuit_id and (p.is_public or p.owner_id is null))
  );
create policy "join public pursuit yourself" on public.pursuit_members
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.pursuits p where p.id = pursuit_id and (p.is_public or p.owner_id is null))
  );
create policy "edit own membership" on public.pursuit_members
  for update using (user_id = auth.uid());
create policy "leave, or owner removes" on public.pursuit_members
  for delete using (
    user_id = auth.uid()
    or exists (select 1 from public.pursuits p where p.id = pursuit_id and p.owner_id = auth.uid())
  );

-- owner membership on create
create function public.handle_new_pursuit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null then
    insert into public.pursuit_members (pursuit_id, user_id, role) values (new.id, new.owner_id, 'owner');
  end if;
  return new;
end $$;
create trigger on_pursuit_created after insert on public.pursuits
  for each row execute function public.handle_new_pursuit();

-- owner adds an accepted friend to an invite-only pursuit
create function public.add_pursuit_member(p uuid, member uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.pursuits pu where pu.id = p and pu.owner_id = auth.uid()) then
    raise exception 'Only the pursuit owner can add members';
  end if;
  if not public.are_friends(auth.uid(), member) then
    raise exception 'You can only add accepted friends';
  end if;
  insert into public.pursuit_members (pursuit_id, user_id) values (p, member)
  on conflict (pursuit_id, user_id) do nothing;
end $$;

-- stats -------------------------------------------------------------------------
create table public.pursuit_stats (
  id uuid primary key default gen_random_uuid(),
  pursuit_id uuid not null references public.pursuits (id) on delete cascade,
  name text not null,
  unit text not null default '',
  direction text not null default 'more' check (direction in ('more', 'less')),
  cadence text not null default 'daily' check (cadence in ('daily', 'whenever')),
  target numeric,
  created_at timestamptz not null default now()
);
alter table public.pursuit_stats enable row level security;
create policy "stats visible with pursuit" on public.pursuit_stats
  for select using (exists (
    select 1 from public.pursuits p where p.id = pursuit_id
      and (p.is_public or p.owner_id is null or p.owner_id = auth.uid() or public.is_pursuit_member(p.id))
  ));
create policy "owner manages stats" on public.pursuit_stats
  for all using (exists (select 1 from public.pursuits p where p.id = pursuit_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.pursuits p where p.id = pursuit_id and p.owner_id = auth.uid()));

-- entries: one value per user/stat/date, with a private note ---------------------
create table public.pursuit_entries (
  user_id uuid not null references auth.users (id) on delete cascade,
  stat_id uuid not null references public.pursuit_stats (id) on delete cascade,
  date date not null,
  value numeric not null,
  note text,
  created_at timestamptz not null default now(),
  primary key (user_id, stat_id, date)
);
alter table public.pursuit_entries enable row level security;
create policy "own entries" on public.pursuit_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- fellow members see VALUES (never notes) through this function only
create function public.pursuit_stat_data(s uuid)
returns table (member_id uuid, display_name text, date date, value numeric)
language plpgsql security definer stable set search_path = public as $$
declare p uuid;
begin
  select ps.pursuit_id into p from public.pursuit_stats ps where ps.id = s;
  if p is null or not public.is_pursuit_member(p) then
    raise exception 'Join this pursuit to see its data';
  end if;
  return query
  select e.user_id, coalesce(pr.display_name, 'anonymous'), e.date, e.value
  from public.pursuit_entries e
  join public.pursuit_members m on m.pursuit_id = p and m.user_id = e.user_id
  left join public.profiles pr on pr.id = e.user_id
  where e.stat_id = s;
end $$;

-- directory: everything you can see, with owner + member counts
create function public.pursuit_directory()
returns table (id uuid, name text, description text, kind text, is_public boolean,
               owner_name text, member_count bigint, is_member boolean, is_owner boolean)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  return query
  select p.id, p.name, p.description, p.kind, p.is_public,
         case when p.owner_id is null then 'DayMax' else coalesce(pr.display_name, 'anonymous') end,
         (select count(*) from public.pursuit_members m where m.pursuit_id = p.id),
         exists (select 1 from public.pursuit_members m where m.pursuit_id = p.id and m.user_id = auth.uid()),
         p.owner_id = auth.uid()
  from public.pursuits p
  left join public.profiles pr on pr.id = p.owner_id
  where p.is_public or p.owner_id is null or p.owner_id = auth.uid() or public.is_pursuit_member(p.id)
  order by (p.owner_id is null) desc, 7 desc;
end $$;

-- pursuits shown on a member's profile (their show_on_profile flags respected)
create function public.member_pursuits(member uuid)
returns table (id uuid, name text, kind text, member_count bigint)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_connected(member) then
    raise exception 'You are not connected with this person';
  end if;
  return query
  select p.id, p.name, p.kind,
         (select count(*) from public.pursuit_members mm where mm.pursuit_id = p.id)
  from public.pursuit_members m
  join public.pursuits p on p.id = m.pursuit_id
  where m.user_id = member and m.show_on_profile;
end $$;

-- built-ins -----------------------------------------------------------------------
insert into public.pursuits (id, owner_id, name, description, kind, is_public) values
  ('33333333-3333-4333-8333-333333333301', null, 'Life', 'The whole point. Your day in 15-minute slots — everyone is a member.', 'life', true),
  ('33333333-3333-4333-8333-333333333302', null, 'Lifts', 'Weights, goals, progression. The original pursuit.', 'lifts', true);

-- everyone (present and future) is in Life
insert into public.pursuit_members (pursuit_id, user_id, role)
select '33333333-3333-4333-8333-333333333301'::uuid, u.id, 'member' from auth.users u
on conflict do nothing;

-- users with lift data are in Lifts
insert into public.pursuit_members (pursuit_id, user_id, role)
select distinct '33333333-3333-4333-8333-333333333302'::uuid, l.user_id, 'member' from public.lift_entries l
on conflict do nothing;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1));
  insert into public.pursuit_members (pursuit_id, user_id, role)
  values ('33333333-3333-4333-8333-333333333301', new.id, 'member')
  on conflict do nothing;
  return new;
end $$;
