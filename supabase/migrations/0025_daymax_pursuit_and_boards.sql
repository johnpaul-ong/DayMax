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
