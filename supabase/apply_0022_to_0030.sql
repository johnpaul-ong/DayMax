-- ============================================================================
-- DayMax — combined migrations 0022 through 0030
--
-- Paste the whole thing into the Supabase SQL editor and run it once.
--
-- 0030 IS A SECURITY PATCH. It closes four independently exploitable holes
-- (privilege escalation via re-parented rows, and an unauthenticated write
-- into any user's diary). Do not deploy the app publicly without it.
--
-- SAFE TO RUN AS ONE BLOCK: wrapped in a single transaction, so if any
-- statement fails the whole thing rolls back and nothing changed. Every
-- statement is idempotent, so running it twice is fine.
-- ============================================================================

begin;
set local statement_timeout = '120s';


-- ==========================================================================
-- 0022_block_duplicate_signups.sql
-- ==========================================================================
-- DayMax migration 22: stop the same person quietly ending up with several
-- accounts.
--
-- WHAT SUPABASE ALREADY DOES: one account per email address, enforced on
-- auth.users. You cannot sign up twice with the exact same string.
--
-- WHAT SLIPS THROUGH: plus-addressing and case. jpong@x.com, JPong@x.com and
-- jpong+test@x.com are three different strings and therefore three accounts,
-- which is how a "duplicate" person appears in a pursuit. This normalises
-- those away and blocks the second signup.
--
-- WHAT IT DELIBERATELY DOES NOT DO: treat different domains as the same person.
-- jpong@ccia.org.au and jpong@gmail.com stay separate accounts, because there
-- is no safe way to tell "my other address" from "a different human with a
-- common name".

create or replace function public.normalize_email(e text)
returns text language sql immutable as $$
  select lower(split_part(split_part(coalesce(e, ''), '@', 1), '+', 1))
      || '@'
      || lower(split_part(coalesce(e, ''), '@', 2));
$$;

create or replace function public.block_duplicate_signup()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  existing text;
begin
  select u.email into existing
  from auth.users u
  where u.id <> new.id
    and public.normalize_email(u.email) = public.normalize_email(new.email)
  limit 1;

  if existing is not null then
    raise exception 'An account already exists for % — sign in with it, or use "forgot password".', existing
      using errcode = 'unique_violation';
  end if;
  return new;
end $$;

drop trigger if exists block_duplicate_signup on auth.users;
create trigger block_duplicate_signup
  before insert on auth.users
  for each row execute function public.block_duplicate_signup();

-- Find any duplicates that already exist, so you can merge or delete them.
-- (Read-only — this is a report, not a change.)
create or replace function public.duplicate_accounts()
returns table (normalized text, accounts bigint, emails text[], ids uuid[])
language sql security definer stable set search_path = public as $$
  select public.normalize_email(u.email),
         count(*),
         array_agg(u.email order by u.created_at),
         array_agg(u.id order by u.created_at)
  from auth.users u
  group by 1
  having count(*) > 1;
$$;


-- ==========================================================================
-- 0023_fix_member_list_filter.sql
-- ==========================================================================
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


-- ==========================================================================
-- 0024_public_profiles.sql
-- ==========================================================================
-- DayMax migration 24: public profiles, per-audience visibility, no more
-- under-18 special-casing.
--
-- WHAT CHANGES
--   * profiles.is_public (default true) — anyone signed in can open your page.
--   * profiles.public_sections — what NON-friends see. profile_sections stays
--     as what friends see. Two audiences, two lists.
--   * Profile data no longer flows through "do we share a track" — that meant a
--     stranger with a public profile showed a blank page. New readers gate on
--     visibility directly.
--   * is_minor() is no longer used to hide people. The function stays (nothing
--     depends on removing it) but search and rosters no longer filter on age.

alter table public.profiles add column if not exists is_public boolean not null default true;
alter table public.profiles add column if not exists public_sections jsonb
  not null default '["ranking","hours","lifts"]'::jsonb;

-- existing accounts opt in to the new default
update public.profiles set is_public = true where is_public is null;

-- Can the caller open this profile at all?
create or replace function public.can_view_profile(member uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select member = auth.uid()
      or public.is_connected(member)
      or exists (select 1 from public.profiles p where p.id = member and p.is_public);
$$;

-- Which sections does THIS caller get? Own profile and friends get the full
-- list; everyone else gets the public subset.
create or replace function public.visible_sections(member uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select case
    when member = auth.uid() then coalesce(p.profile_sections, '["ranking","hours","lifts"]'::jsonb)
    when public.is_connected(member) then coalesce(p.profile_sections, '["ranking","hours","lifts"]'::jsonb)
    when p.is_public then coalesce(p.public_sections, '["ranking","hours","lifts"]'::jsonb)
    else '[]'::jsonb
  end
  from public.profiles p where p.id = member;
$$;

create or replace function public.section_visible(member uuid, s text)
returns boolean language sql security definer stable set search_path = public as $$
  select public.visible_sections(member) ? s;
$$;

-- profile header, plus everything the page needs to render the right buttons.
-- Postgres won't let create-or-replace change a function's OUT columns, and
-- this one gains is_public / is_self / friend_status — so drop it first.
drop function if exists public.member_profile(uuid);

create function public.member_profile(member uuid)
returns table (display_name text, username text, sections jsonb,
               is_public boolean, is_self boolean, friend_status text)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.can_view_profile(member) then
    raise exception 'This profile is private';
  end if;
  return query
  select coalesce(p.display_name, 'anonymous'),
         p.username,
         public.visible_sections(member),
         p.is_public,
         member = auth.uid(),
         case
           when member = auth.uid() then 'self'
           when public.are_friends(auth.uid(), member) then 'friends'
           when exists (select 1 from public.friendships f
                        where f.requester = auth.uid() and f.addressee = member and f.status = 'pending')
             then 'pending_out'
           when exists (select 1 from public.friendships f
                        where f.requester = member and f.addressee = auth.uid() and f.status = 'pending')
             then 'pending_in'
           else 'none'
         end
  from public.profiles p where p.id = member;
end $$;

-- Day totals for a profile, gated on visibility rather than on sharing a
-- track. This is what makes a public profile actually show something.
create or replace function public.member_day_totals(member uuid, from_date date default null, to_date date default null)
returns table (date date, productive numeric, brainrot numeric, social numeric, other numeric)
language plpgsql security definer stable set search_path = public as $$
declare
  is_demo_member boolean;
  local_ts timestamp;
  local_day date;
  local_slot int;
begin
  if not public.can_view_profile(member) then raise exception 'This profile is private'; end if;
  if not (public.section_visible(member, 'ranking') or public.section_visible(member, 'hours')) then
    return;
  end if;

  select p.is_demo into is_demo_member from public.profiles p where p.id = member;
  local_ts := public.viewer_local_ts();
  local_day := local_ts::date;
  local_slot := extract(hour from local_ts)::int * 4 + extract(minute from local_ts)::int / 15;

  return query
  select e.date,
         sum(case when e.category in (1, 2) then 0.25 else 0 end),
         sum(case when e.category in (6, 9) then 0.25 else 0 end),
         sum(case when e.category = 3 then 0.25 else 0 end),
         sum(case when e.category not in (1, 2, 3, 6, 9) then 0.25 else 0 end)
  from public.day_entries e
  where e.user_id = member
    and (from_date is null or e.date >= from_date)
    and (to_date is null or e.date <= to_date)
    and (not coalesce(is_demo_member, false)
         or e.date < local_day
         or (e.date = local_day and e.slot <= local_slot))
  group by e.date
  order by e.date;
end $$;

create or replace function public.member_lifts(member uuid)
returns table (date date, exercise text, weight_kg numeric, reps text)
language plpgsql security definer stable set search_path = public as $$
declare
  is_demo_member boolean;
  local_day date;
begin
  if not public.can_view_profile(member) then raise exception 'This profile is private'; end if;
  if not public.section_visible(member, 'lifts') then return; end if;

  select p.is_demo into is_demo_member from public.profiles p where p.id = member;
  local_day := public.viewer_local_ts()::date;

  return query
  select l.date, l.exercise, l.weight_kg, l.reps
  from public.lift_entries l
  where l.user_id = member
    and l.weight_kg is not null
    and (not coalesce(is_demo_member, false) or l.date < local_day)
  order by l.date;
end $$;

-- metrics follow their own section
create or replace function public.member_day_metrics(member uuid)
returns table (date date, emotional_score numeric, tired numeric, start_friction numeric, end_brain_fatigue numeric, weight_kg numeric)
language plpgsql security definer stable set search_path = public as $$
declare
  is_demo_member boolean;
  local_day date;
begin
  if not public.can_view_profile(member) then raise exception 'This profile is private'; end if;
  if not public.section_visible(member, 'metrics') then return; end if;

  select p.is_demo into is_demo_member from public.profiles p where p.id = member;
  local_day := public.viewer_local_ts()::date;

  return query
  select m.date, m.emotional_score, m.tired, m.start_friction, m.end_brain_fatigue, m.weight_kg
  from public.day_metrics m
  where m.user_id = member
    and (not coalesce(is_demo_member, false) or m.date < local_day)
  order by m.date;
end $$;

-- The 15-minute strip. Categories follow the 'days' section; LABELS are
-- stricter — only yourself, demo legends, or someone who explicitly set
-- raw_labels on a shared track ever sees the words you wrote.
drop function if exists public.member_day_strip(uuid);
drop function if exists public.member_day_strip(uuid, date, date);

create function public.member_day_strip(member uuid, from_date date default null, to_date date default null)
returns table (date date, slot smallint, category smallint, label text)
language plpgsql security definer stable set search_path = public as $$
declare
  is_demo_member boolean;
  show_labels boolean;
  local_ts timestamp;
  local_day date;
  local_slot int;
begin
  if not public.can_view_profile(member) then raise exception 'This profile is private'; end if;
  if not public.section_visible(member, 'days') then return; end if;

  select p.is_demo into is_demo_member from public.profiles p where p.id = member;

  show_labels := member = auth.uid()
      or coalesce(is_demo_member, false)
      or exists (
        select 1 from public.track_members a
        join public.track_members b on a.track_id = b.track_id
        where a.user_id = auth.uid() and b.user_id = member and b.share_rule = 'raw_labels'
      );

  local_ts := public.viewer_local_ts();
  local_day := local_ts::date;
  local_slot := extract(hour from local_ts)::int * 4 + extract(minute from local_ts)::int / 15;

  return query
  select e.date, e.slot, e.category,
         case when show_labels then e.label else null end
  from public.day_entries e
  where e.user_id = member
    and (from_date is null or e.date >= from_date)
    and (to_date is null or e.date <= to_date)
    and (not coalesce(is_demo_member, false)
         or e.date < local_day
         or (e.date = local_day and e.slot <= local_slot))
  order by e.date, e.slot;
end $$;

-- No more age gating -----------------------------------------------------------

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
    and p.id <> auth.uid()
    and (p.display_name ilike '%' || q || '%' or p.username ilike '%' || q || '%')
  limit 20;
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
  if k = 'life' then return; end if;   -- everyone is in Life; no roster

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
    and (k = 'custom' or public.is_connected(m.user_id) or coalesce(pr.is_public, false))
  order by (m.role = 'owner') desc, coalesce(pr.display_name, 'anonymous');
end $$;


-- ==========================================================================
-- 0025_daymax_pursuit_and_boards.sql
-- ==========================================================================
-- DayMax migration 25: the DayMax pursuit (rate your day out of 10), and a
-- message board on every track.

-- 1. The DayMax pursuit -------------------------------------------------------
-- Built-in and ownerless like Life and Lifts, but kind='custom' so it uses the
-- ordinary stat machinery — chart, leaderboard, logging form, private notes.

insert into public.pursuits (id, owner_id, name, description, kind, is_public) values
  ('33333333-3333-4333-8333-333333333303', null, 'DayMax',
   'Rate the day out of 10. Arbitrary on purpose — the number only means something once you have a few hundred of them.',
   'custom', true)
on conflict (id) do nothing;

insert into public.pursuit_stats (id, pursuit_id, name, unit, direction, cadence, target)
values ('44444444-4444-4444-8444-444444444401',
        '33333333-3333-4333-8333-333333333303',
        'Day rating', '/10', 'more', 'daily', null)
on conflict (id) do nothing;

-- everyone who exists now joins
insert into public.pursuit_members (pursuit_id, user_id, role)
select '33333333-3333-4333-8333-333333333303'::uuid, u.id, 'member' from auth.users u
on conflict do nothing;

-- ...and everyone who signs up later
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
  values ('33333333-3333-4333-8333-333333333301', new.id, 'member'),
         ('33333333-3333-4333-8333-333333333303', new.id, 'member')
  on conflict do nothing;
  return new;
end $$;

-- Leaving Life is allowed (the existing "leave, or owner removes" policy already
-- permits it — this comment is here so nobody re-adds a special case). Your day
-- data is yours and is untouched by leaving; rejoin from Explore any time.


-- 1b. Only Tony and Natasha lift ----------------------------------------------
-- A 50-tonne Hulk deadlift and an 810kg Asgardian pull made every human lift
-- leaderboard meaningless — a real beginner would never appear next to them.
-- Bruce, Thor and Steve keep their days; they just stop lifting.

delete from public.lift_entries
 where user_id in ('11111111-1111-4111-8111-111111111101'::uuid,   -- Bruce
                   '11111111-1111-4111-8111-111111111103'::uuid,   -- Thor
                   '11111111-1111-4111-8111-111111111104'::uuid);  -- Steve

delete from public.lift_goals
 where user_id in ('11111111-1111-4111-8111-111111111101'::uuid,
                   '11111111-1111-4111-8111-111111111103'::uuid,
                   '11111111-1111-4111-8111-111111111104'::uuid);

-- and drop them from the Lifts pursuit roster
delete from public.pursuit_members
 where pursuit_id = '33333333-3333-4333-8333-333333333302'
   and user_id in ('11111111-1111-4111-8111-111111111101'::uuid,
                   '11111111-1111-4111-8111-111111111103'::uuid,
                   '11111111-1111-4111-8111-111111111104'::uuid);

-- make sure the two who do lift are in it
insert into public.pursuit_members (pursuit_id, user_id, role)
values ('33333333-3333-4333-8333-333333333302', '11111111-1111-4111-8111-111111111102', 'member'),
       ('33333333-3333-4333-8333-333333333302', '11111111-1111-4111-8111-111111111105', 'member')
on conflict do nothing;


-- 2. Track message boards -----------------------------------------------------

alter table public.tracks add column if not exists board_enabled boolean not null default true;

create table if not exists public.track_posts (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 4000),
  visibility text not null default 'track' check (visibility in ('track', 'private')),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists track_posts_track_idx on public.track_posts (track_id, created_at desc);
alter table public.track_posts enable row level security;

create table if not exists public.track_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.track_posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists track_comments_post_idx on public.track_comments (post_id, created_at);
alter table public.track_comments enable row level security;

-- a post is visible if you're in the track AND (it's shared, or it's yours)
create or replace function public.can_see_post(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.track_posts tp
    where tp.id = p
      and public.is_track_member(tp.track_id)
      and (tp.visibility = 'track' or tp.user_id = auth.uid())
  );
$$;

drop policy if exists "members read shared posts" on public.track_posts;
create policy "members read shared posts" on public.track_posts
  for select using (
    public.is_track_member(track_id) and (visibility = 'track' or user_id = auth.uid())
  );

drop policy if exists "members post" on public.track_posts;
create policy "members post" on public.track_posts
  for insert with check (
    user_id = auth.uid()
    and public.is_track_member(track_id)
    and exists (select 1 from public.tracks t where t.id = track_id and t.board_enabled)
  );

drop policy if exists "authors edit own posts" on public.track_posts;
create policy "authors edit own posts" on public.track_posts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- authors delete their own; track owners can remove anything on their board
drop policy if exists "authors or track owner delete posts" on public.track_posts;
create policy "authors or track owner delete posts" on public.track_posts
  for delete using (
    user_id = auth.uid()
    or exists (select 1 from public.tracks t where t.id = track_id and t.owner_id = auth.uid())
  );

drop policy if exists "read comments on visible posts" on public.track_comments;
create policy "read comments on visible posts" on public.track_comments
  for select using (public.can_see_post(post_id));

-- you can't comment on someone's private post — can_see_post already excludes it
drop policy if exists "comment on visible posts" on public.track_comments;
create policy "comment on visible posts" on public.track_comments
  for insert with check (user_id = auth.uid() and public.can_see_post(post_id));

drop policy if exists "authors or post owner delete comments" on public.track_comments;
create policy "authors or post owner delete comments" on public.track_comments
  for delete using (
    user_id = auth.uid()
    or exists (select 1 from public.track_posts tp where tp.id = post_id and tp.user_id = auth.uid())
  );

-- the board, with author names and comment counts, newest first
create or replace function public.track_board(t uuid, limit_n int default 50)
returns table (id uuid, user_id uuid, display_name text, username text, body text,
               visibility text, created_at timestamptz, edited_at timestamptz, comment_count bigint)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_track_member(t) then raise exception 'Not a member of this track'; end if;
  return query
  select tp.id, tp.user_id,
         coalesce(pr.display_name, 'anonymous'), pr.username,
         tp.body, tp.visibility, tp.created_at, tp.edited_at,
         (select count(*) from public.track_comments c where c.post_id = tp.id)
  from public.track_posts tp
  left join public.profiles pr on pr.id = tp.user_id
  where tp.track_id = t
    and (tp.visibility = 'track' or tp.user_id = auth.uid())
  order by tp.created_at desc
  limit limit_n;
end $$;

create or replace function public.post_comments(p uuid)
returns table (id uuid, user_id uuid, display_name text, username text, body text, created_at timestamptz)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.can_see_post(p) then raise exception 'You cannot see this post'; end if;
  return query
  select c.id, c.user_id, coalesce(pr.display_name, 'anonymous'), pr.username, c.body, c.created_at
  from public.track_comments c
  left join public.profiles pr on pr.id = c.user_id
  where c.post_id = p
  order by c.created_at;
end $$;


-- ==========================================================================
-- 0026_avengers_own_life.sql
-- ==========================================================================
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


-- ==========================================================================
-- 0027_teams.sql
-- ==========================================================================
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


-- ==========================================================================
-- 0028_full_profiles_by_default.sql
-- ==========================================================================
-- DayMax migration 28: a profile shows everything by default, new pursuits are
-- public by default, and the Avengers stay out of the everyone-pursuit.

-- 1. Full profiles as standard ------------------------------------------------
-- The default was ["ranking","hours","lifts"], which quietly hid the year
-- heatmap, the 15-minute grid and the how-you-felt chart — the parts that make
-- a profile worth opening. All five sections are now on by default, for
-- friends and for the public.

alter table public.profiles
  alter column public_sections set default '["ranking","hours","lifts","metrics","days"]'::jsonb;
alter table public.profiles
  alter column profile_sections set default '["ranking","hours","lifts","metrics","days"]'::jsonb;

-- bring existing accounts up to the new default, without clobbering anyone who
-- has deliberately trimmed theirs down
update public.profiles
   set profile_sections = '["ranking","hours","lifts","metrics","days"]'::jsonb
 where profile_sections is null
    or profile_sections = '["ranking","hours","lifts"]'::jsonb;

update public.profiles
   set public_sections = '["ranking","hours","lifts","metrics","days"]'::jsonb
 where public_sections is null
    or public_sections = '["ranking","hours","lifts"]'::jsonb;

-- the fallbacks inside the readers have to agree with the column defaults
create or replace function public.visible_sections(member uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select case
    when member = auth.uid()
      then coalesce(p.profile_sections, '["ranking","hours","lifts","metrics","days"]'::jsonb)
    when public.is_connected(member)
      then coalesce(p.profile_sections, '["ranking","hours","lifts","metrics","days"]'::jsonb)
    when p.is_public
      then coalesce(p.public_sections, '["ranking","hours","lifts","metrics","days"]'::jsonb)
    else '[]'::jsonb
  end
  from public.profiles p where p.id = member;
$$;

-- 2. New pursuits are public --------------------------------------------------
-- A pursuit nobody can find is a pursuit nobody joins. Invite-only stays
-- available, it just stops being the default.

alter table public.pursuits alter column is_public set default true;

-- Existing user-made pursuits are left as their owners set them. If you want
-- to open them all up (fine on a small install, rude on a big one), run:
--
--   update public.pursuits set is_public = true where owner_id is not null;
--
-- Or flip a single one from its own page: "Make public".

-- 3. Belt and braces: the Avengers are not in the everyone-pursuit ------------
-- 0026 does this too. Repeated here because migration 0013's seed re-adds
-- every auth user to Life, so anyone who re-ran 0013 after 0026 got them back.

delete from public.pursuit_members
 where pursuit_id = '33333333-3333-4333-8333-333333333301'
   and user_id in (select id from public.profiles where is_demo);

delete from public.pursuit_members
 where pursuit_id = '33333333-3333-4333-8333-333333333303'
   and user_id in (select id from public.profiles where is_demo);

insert into public.pursuit_members (pursuit_id, user_id, role)
select '33333333-3333-4333-8333-333333333304'::uuid, p.id, 'member'
from public.profiles p where p.is_demo
on conflict do nothing;

-- Check it: this should return zero rows.
--   select p.display_name from public.pursuit_members m
--   join public.profiles p on p.id = m.user_id
--   where m.pursuit_id = '33333333-3333-4333-8333-333333333301' and p.is_demo;


-- ==========================================================================
-- 0029_pursuit_previews.sql
-- ==========================================================================
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


-- ==========================================================================
-- 0030_security_hardening.sql
-- ==========================================================================
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


commit;

-- ============================================================================
-- VERIFY — run separately after the commit succeeds. All should be true.
-- ============================================================================
-- select
--   (select count(*) from public.pursuit_members m join public.profiles p on p.id=m.user_id
--     where m.pursuit_id='33333333-3333-4333-8333-333333333301' and p.is_demo)=0 as no_avengers_in_life,
--   (select count(*) from public.pursuit_members
--     where pursuit_id='33333333-3333-4333-8333-333333333304')=6 as six_in_avengers,
--   (select bool_and(is_public) from public.pursuits where owner_id is not null) as user_pursuits_public,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname in ('demo_copy_day','demo_fill_to_today','duplicate_accounts'))=0
--     as dangerous_functions_gone,
--   (select count(*) from pg_trigger where tgname in
--     ('freeze_pursuit_membership','freeze_track_membership','freeze_friendship_parties','protect_profile_columns'))=4
--     as escalation_triggers_installed,
--   (select count(*) from pg_indexes where indexname='pursuit_entries_stat_idx')=1 as hot_index_present;
