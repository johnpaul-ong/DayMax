-- DayMax migration 30: security hardening. RUN THIS ONE FIRST.
--
-- A security audit found four independently exploitable holes, three of them
-- the same mistake repeated. Every one is reachable from the public PostgREST
-- API with nothing but a signed-in account (one needs no account at all).
--
-- THE REPEATED MISTAKE: an UPDATE policy that constrains who owns a row but
-- not which parent it points at. Postgres validates the NEW row against
-- WITH CHECK (falling back to USING when WITH CHECK is absent). If the foreign
-- key isn't pinned there, a row can be re-parented — which walks straight past
-- the INSERT policy that was doing the real access control.

-- ---------------------------------------------------------------------------
-- 1. CRITICAL — join any private track by re-pointing your own membership
--    PATCH /track_members?user_id=eq.<me> {"track_id":"<someone else's>"}
--    -> is_track_member() -> compare_*, raw 15-minute labels, the board.
-- ---------------------------------------------------------------------------
-- The policy can only see the NEW row, so pinning track_id has to happen in a
-- trigger (below) which can compare OLD and NEW. The policy keeps the
-- ownership and share-rule constraints.
drop policy if exists "edit own share rule" on public.track_members;
create policy "edit own share rule" on public.track_members
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. CRITICAL — forge a friendship with anyone
--    One pending request in, rewritten to {"requester":"<victim>"} + accepted.
--    -> are_friends() -> is_connected() -> their friend-tier profile, metrics.
-- ---------------------------------------------------------------------------
drop policy if exists "addressee accepts" on public.friendships;
create policy "addressee accepts" on public.friendships
  for update
  using (addressee = auth.uid() and status = 'pending')
  with check (addressee = auth.uid() and status = 'accepted');

-- Postgres compares WITH CHECK against the NEW row only, so `addressee =
-- auth.uid()` above stops you inserting yourself as the addressee of a forged
-- pair, and `requester` can no longer be swapped because USING already matched
-- the old row and the new row must still be addressed to you. Belt and braces:
create or replace function public.freeze_friendship_parties()
returns trigger language plpgsql as $$
begin
  if new.requester <> old.requester or new.addressee <> old.addressee then
    raise exception 'Cannot change who a friendship is between';
  end if;
  return new;
end $$;
drop trigger if exists freeze_friendship_parties on public.friendships;
create trigger freeze_friendship_parties before update on public.friendships
  for each row execute function public.freeze_friendship_parties();

-- ---------------------------------------------------------------------------
-- 3. CRITICAL — join any invite-only pursuit by re-pointing your Life membership
-- ---------------------------------------------------------------------------
create or replace function public.freeze_pursuit_membership()
returns trigger language plpgsql as $$
begin
  if new.pursuit_id <> old.pursuit_id or new.user_id <> old.user_id then
    raise exception 'Cannot move a membership to another pursuit';
  end if;
  return new;
end $$;
drop trigger if exists freeze_pursuit_membership on public.pursuit_members;
create trigger freeze_pursuit_membership before update on public.pursuit_members
  for each row execute function public.freeze_pursuit_membership();

-- same for track memberships, since policy expressions on the OLD row are
-- easy to get subtly wrong
create or replace function public.freeze_track_membership()
returns trigger language plpgsql as $$
begin
  if new.track_id <> old.track_id or new.user_id <> old.user_id then
    raise exception 'Cannot move a membership to another track';
  end if;
  return new;
end $$;
drop trigger if exists freeze_track_membership on public.track_members;
create trigger freeze_track_membership before update on public.track_members
  for each row execute function public.freeze_track_membership();

-- and for posts, which could be re-parented onto a private board
create or replace function public.freeze_post_track()
returns trigger language plpgsql as $$
begin
  if new.track_id <> old.track_id or new.user_id <> old.user_id then
    raise exception 'Cannot move a post to another track';
  end if;
  new.edited_at := now();
  return new;
end $$;
drop trigger if exists freeze_post_track on public.track_posts;
create trigger freeze_post_track before update on public.track_posts
  for each row execute function public.freeze_post_track();

-- ---------------------------------------------------------------------------
-- 4. CRITICAL — unauthenticated writes into ANY user's diary.
--    demo_copy_day / demo_fill_to_today / demo_intraday_tick are SECURITY
--    DEFINER, take a user id, check nothing, and were never REVOKEd — so the
--    anon role could call them over the REST API and insert rows into a
--    stranger's day_entries and lift_entries, unbounded.
--    They are dead code: migration 0016 replaced the copy-forward approach
--    with time-gated reads. Delete them.
-- ---------------------------------------------------------------------------
drop function if exists public.demo_copy_day(uuid, date, date);
drop function if exists public.demo_fill_to_today();
drop function if exists public.demo_intraday_tick();
drop function if exists public.demo_pick_source(uuid, date);

-- ---------------------------------------------------------------------------
-- 5. HIGH — data-leak surfaces exposed to every signed-in caller
-- ---------------------------------------------------------------------------

-- duplicate_accounts() returned every email address on the platform.
-- It was a one-off diagnostic; the query lives in supabase/seed/ instead.
drop function if exists public.duplicate_accounts();

-- is_minor() let anyone probe an arbitrary user's age bracket, which is a
-- derived read of birth_date that RLS otherwise forbids. Nothing calls it any
-- more (0024 removed the age gating), so lock it away from the API.
revoke all on function public.is_minor(uuid) from anon, authenticated;

-- pursuit_stat_top(s, n): n was caller-controlled, and every account is
-- auto-joined to the public DayMax pursuit — so n=100000 dumped a directory of
-- every user's name and handle. Clamp it.
create or replace function public.pursuit_stat_top(s uuid, n int default 5)
returns table (member_id uuid, display_name text, username text, score numeric, entries bigint)
language plpgsql security definer stable set search_path = public as $$
declare
  p uuid;
  cad text;
  lim int := least(greatest(coalesce(n, 5), 1), 25);   -- never a bulk export
begin
  select ps.pursuit_id, ps.cadence into p, cad
  from public.pursuit_stats ps where ps.id = s and not coalesce(ps.hidden, false);
  if p is null or not public.can_see_pursuit(p) then raise exception 'You cannot see this pursuit'; end if;

  return query
  select e.user_id,
         coalesce(pr.display_name, 'anonymous'),
         pr.username,
         case when cad = 'daily' then round(sum(e.value)::numeric, 1)
              else round(max(e.value)::numeric, 1) end,
         count(*)
  from public.pursuit_entries e
  join public.pursuit_members pm on pm.pursuit_id = p and pm.user_id = e.user_id
  left join public.profiles pr on pr.id = e.user_id
  where e.stat_id = s
  group by e.user_id, pr.display_name, pr.username
  order by 4 desc
  limit lim;
end $$;

-- Signup no longer echoes the stored address back to an unauthenticated
-- caller — that confirmed both that an account exists and its exact spelling.
create or replace function public.block_duplicate_signup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from auth.users u
    where u.id <> new.id
      and public.normalize_email(u.email) = public.normalize_email(new.email)
  ) then
    raise exception 'An account already exists for this email address. Sign in, or use "forgot password".'
      using errcode = 'unique_violation';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 6. HIGH — writes that were only checked in the browser
-- ---------------------------------------------------------------------------

-- You could log entries to a pursuit you had never joined, which put you on
-- its public preview boards and skewed its averages. Membership is now
-- required at the database, not just hidden in the UI.
drop policy if exists "own entries" on public.pursuit_entries;
create policy "own entries" on public.pursuit_entries
  for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.pursuit_stats ps
      join public.pursuit_members pm on pm.pursuit_id = ps.pursuit_id
      where ps.id = stat_id and pm.user_id = auth.uid()
    )
  );

-- `hidden` on a stat was a client-side filter only: the name, target and every
-- member's values stayed readable through the table API and the readers.
drop policy if exists "stats visible with pursuit" on public.pursuit_stats;
create policy "stats visible with pursuit" on public.pursuit_stats
  for select using (
    exists (
      select 1 from public.pursuits p
      where p.id = pursuit_id
        and (p.is_public or p.owner_id is null or p.owner_id = auth.uid() or public.is_pursuit_member(p.id))
    )
    and (not coalesce(hidden, false) or exists (
      select 1 from public.pursuits p where p.id = pursuit_id and p.owner_id = auth.uid()
    ))
  );

create or replace function public.pursuit_stat_data(s uuid)
returns table (member_id uuid, display_name text, date date, value numeric)
language plpgsql security definer stable set search_path = public as $$
declare p uuid;
begin
  select ps.pursuit_id into p from public.pursuit_stats ps
   where ps.id = s
     and (not coalesce(ps.hidden, false)
          or exists (select 1 from public.pursuits pu where pu.id = ps.pursuit_id and pu.owner_id = auth.uid()));
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

create or replace function public.pursuit_stat_spread(s uuid, buckets int default 8)
returns table (bucket_low numeric, bucket_high numeric, members bigint)
language plpgsql security definer set search_path = public as $$
declare
  p uuid;
  lo numeric; hi numeric; step numeric;
  b int := least(greatest(coalesce(buckets, 8), 2), 20);   -- no divide-by-zero
begin
  select ps.pursuit_id into p from public.pursuit_stats ps
   where ps.id = s and not coalesce(ps.hidden, false);
  if p is null or not public.can_see_pursuit(p) then raise exception 'You cannot see this pursuit'; end if;

  create temp table if not exists _spread (uid uuid, v numeric) on commit drop;
  delete from _spread;
  insert into _spread
  select e.user_id, avg(e.value)
  from public.pursuit_entries e
  join public.pursuit_members pm on pm.pursuit_id = p and pm.user_id = e.user_id
  where e.stat_id = s group by e.user_id;

  select min(v), max(v) into lo, hi from _spread;
  if lo is null then return; end if;
  if hi = lo then hi := lo + 1; end if;
  step := (hi - lo) / b;

  return query
  select round((lo + step * g)::numeric, 1),
         round((lo + step * (g + 1))::numeric, 1),
         (select count(*) from _spread sp
           where sp.v >= lo + step * g and (sp.v < lo + step * (g + 1) or g = b - 1))
  from generate_series(0, b - 1) g;
end $$;

-- profiles: you could set your own is_demo = true — which is_connected(),
-- can_view_profile() and member_day_strip's label gate all trust — and write a
-- username straight past set_username()'s charset/reserved-word rules.
-- The trigger lets set_username() through via a transaction-local flag rather
-- than DDL: `alter table ... disable trigger` needs table ownership, takes an
-- ACCESS EXCLUSIVE lock, and would apply to every session, not just this one.
create or replace function public.protect_profile_columns()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Cannot change profile id';
  end if;
  if new.is_demo is distinct from old.is_demo then
    raise exception 'is_demo is not user-settable';
  end if;
  if new.username is distinct from old.username
     and coalesce(current_setting('daymax.setting_username', true), '') <> 'on' then
    raise exception 'Use set_username() to change your handle';
  end if;
  return new;
end $$;
drop trigger if exists protect_profile_columns on public.profiles;
create trigger protect_profile_columns before update on public.profiles
  for each row execute function public.protect_profile_columns();

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
  perform set_config('daymax.setting_username', 'on', true);  -- true = txn-local
  update public.profiles set username = lower(u), username_chosen = true where id = auth.uid();
  perform set_config('daymax.setting_username', 'off', true);
end $$;

-- ---------------------------------------------------------------------------
-- 7. PERFORMANCE — indexes for the columns actually filtered on
--    Every one of these is a leading-column mismatch: the primary key starts
--    with a different column, so these lookups were sequential scans.
-- ---------------------------------------------------------------------------

-- pursuit_entries PK is (user_id, stat_id, date), but every preview and
-- leaderboard filters on stat_id alone.
create index if not exists pursuit_entries_stat_idx on public.pursuit_entries (stat_id, date);

-- track_members / pursuit_members PKs lead with the parent id, but
-- is_connected() and member_pursuits() filter by user_id.
create index if not exists track_members_user_idx on public.track_members (user_id);
create index if not exists pursuit_members_user_idx on public.pursuit_members (user_id);

-- friendships is unique(requester, addressee); are_friends() also looks up by
-- addressee, which that index cannot serve.
create index if not exists friendships_addressee_idx on public.friendships (addressee, requester);

-- pursuit_stats is read per pursuit on every page load
create index if not exists pursuit_stats_pursuit_idx on public.pursuit_stats (pursuit_id, created_at);

analyze public.pursuit_entries;
analyze public.track_members;
analyze public.pursuit_members;
analyze public.friendships;
