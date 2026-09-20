-- DayMax migration 41: daily feed on a challenge (posts, comments, likes,
-- image uploads). Together they turn a challenge page from a leaderboard
-- into a group chat that happens to have a leaderboard on top.
--
-- MODEL. One thread per (challenge, calendar day):
--   * challenge_posts        one "how was today" entry per person per day
--                            (or more -- no unique constraint). Text
--                            and/or image; must have at least one.
--   * challenge_post_reactions   one "like" (or future emoji) per person
--                                per post.
--   * challenge_post_comments    replies to a post, flat list.
--   * challenge_comment_reactions   likes on individual comments.
--
-- SECURITY.
--   * Read: only members of the challenge (via public.is_challenge_member).
--   * Write: only the author, and only for challenges they're a member of.
--   * Freeze trigger on each row: you cannot re-parent a post to another
--     challenge or reassign the author. Same class of hole 0030 patched
--     on other tables.
--
-- STORAGE. Images live in the 'challenge-images' bucket. Path scheme:
--   {challenge_id}/{user_id}/{uuid}.{ext}
-- The migration ensures the bucket exists and lays down RLS on
-- storage.objects so only members can read a challenge's images and
-- only the author can upload/delete their own.

-- ---------------------------------------------------------------------------
-- 1. Posts
-- ---------------------------------------------------------------------------

create table if not exists public.challenge_posts (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  post_date date not null,
  body text,
  image_path text,
  created_at timestamptz not null default now(),
  check (coalesce(nullif(trim(body), ''), image_path) is not null)
);

create index if not exists challenge_posts_challenge_date_idx
  on public.challenge_posts (challenge_id, post_date, created_at desc);
create index if not exists challenge_posts_user_idx
  on public.challenge_posts (user_id, created_at desc);

alter table public.challenge_posts enable row level security;

drop policy if exists "members read posts" on public.challenge_posts;
create policy "members read posts" on public.challenge_posts
  for select using (public.is_challenge_member(challenge_id));

drop policy if exists "members post" on public.challenge_posts;
create policy "members post" on public.challenge_posts
  for insert with check (
    user_id = auth.uid()
    and public.is_challenge_member(challenge_id)
  );

drop policy if exists "author edits post" on public.challenge_posts;
create policy "author edits post" on public.challenge_posts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "author deletes post" on public.challenge_posts;
create policy "author deletes post" on public.challenge_posts
  for delete using (user_id = auth.uid());

-- Freeze parent + author on UPDATE.
create or replace function public.freeze_challenge_post()
returns trigger language plpgsql as $$
begin
  if new.challenge_id <> old.challenge_id or new.user_id <> old.user_id then
    raise exception 'Cannot re-parent a post';
  end if;
  return new;
end $$;
drop trigger if exists freeze_challenge_post on public.challenge_posts;
create trigger freeze_challenge_post before update on public.challenge_posts
  for each row execute function public.freeze_challenge_post();

-- ---------------------------------------------------------------------------
-- 2. Post reactions ("likes"; kind is future-proofing for emoji)
-- ---------------------------------------------------------------------------

create table if not exists public.challenge_post_reactions (
  post_id uuid not null references public.challenge_posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'like',
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, kind)
);

alter table public.challenge_post_reactions enable row level security;

drop policy if exists "members read post reactions" on public.challenge_post_reactions;
create policy "members read post reactions" on public.challenge_post_reactions
  for select using (
    exists (
      select 1 from public.challenge_posts p
       where p.id = post_id and public.is_challenge_member(p.challenge_id)
    )
  );

drop policy if exists "react to a post" on public.challenge_post_reactions;
create policy "react to a post" on public.challenge_post_reactions
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.challenge_posts p
       where p.id = post_id and public.is_challenge_member(p.challenge_id)
    )
  );

drop policy if exists "unreact my reaction" on public.challenge_post_reactions;
create policy "unreact my reaction" on public.challenge_post_reactions
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Comments
-- ---------------------------------------------------------------------------

create table if not exists public.challenge_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.challenge_posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists challenge_post_comments_post_idx
  on public.challenge_post_comments (post_id, created_at);

alter table public.challenge_post_comments enable row level security;

drop policy if exists "members read comments" on public.challenge_post_comments;
create policy "members read comments" on public.challenge_post_comments
  for select using (
    exists (
      select 1 from public.challenge_posts p
       where p.id = post_id and public.is_challenge_member(p.challenge_id)
    )
  );

drop policy if exists "members comment" on public.challenge_post_comments;
create policy "members comment" on public.challenge_post_comments
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.challenge_posts p
       where p.id = post_id and public.is_challenge_member(p.challenge_id)
    )
  );

drop policy if exists "author edits comment" on public.challenge_post_comments;
create policy "author edits comment" on public.challenge_post_comments
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "author deletes comment" on public.challenge_post_comments;
create policy "author deletes comment" on public.challenge_post_comments
  for delete using (user_id = auth.uid());

-- Notification to the post author when someone comments on it.
create or replace function public.notify_challenge_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  post_owner uuid;
  ch_id uuid;
  commenter_name text;
begin
  select p.user_id, p.challenge_id into post_owner, ch_id
    from public.challenge_posts p where p.id = new.post_id;
  -- don't ping yourself
  if post_owner is null or post_owner = new.user_id then return new; end if;
  select coalesce(pr.display_name, 'someone') into commenter_name
    from public.profiles pr where pr.id = new.user_id;
  perform public.emit_notification(
    post_owner,
    'comment_reply',
    commenter_name || ' commented on your post',
    left(new.body, 120),
    '/challenges/' || ch_id::text,
    new.user_id,
    jsonb_build_object('post_id', new.post_id, 'challenge_id', ch_id)
  );
  return new;
end $$;

drop trigger if exists notify_challenge_comment on public.challenge_post_comments;
create trigger notify_challenge_comment after insert on public.challenge_post_comments
  for each row execute function public.notify_challenge_comment();

-- ---------------------------------------------------------------------------
-- 4. Comment reactions
-- ---------------------------------------------------------------------------

create table if not exists public.challenge_comment_reactions (
  comment_id uuid not null references public.challenge_post_comments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'like',
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id, kind)
);

alter table public.challenge_comment_reactions enable row level security;

drop policy if exists "members read comment reactions" on public.challenge_comment_reactions;
create policy "members read comment reactions" on public.challenge_comment_reactions
  for select using (
    exists (
      select 1
        from public.challenge_post_comments c
        join public.challenge_posts p on p.id = c.post_id
       where c.id = comment_id and public.is_challenge_member(p.challenge_id)
    )
  );

drop policy if exists "react to a comment" on public.challenge_comment_reactions;
create policy "react to a comment" on public.challenge_comment_reactions
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1
        from public.challenge_post_comments c
        join public.challenge_posts p on p.id = c.post_id
       where c.id = comment_id and public.is_challenge_member(p.challenge_id)
    )
  );

drop policy if exists "unreact my comment reaction" on public.challenge_comment_reactions;
create policy "unreact my comment reaction" on public.challenge_comment_reactions
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. Feed RPC: one query pulls a day's posts + like/comment counts +
--    author names + whether the caller reacted. Beats per-post fetches.
-- ---------------------------------------------------------------------------

drop function if exists public.challenge_day_feed(uuid, date);
create function public.challenge_day_feed(p_challenge uuid, p_date date)
returns table (
  id uuid, user_id uuid, display_name text, username text, team text,
  body text, image_path text, created_at timestamptz,
  like_count int, comment_count int, my_like boolean, mine boolean
)
language sql security definer stable set search_path = public as $$
  select p.id, p.user_id,
         coalesce(pr.display_name, 'anonymous'),
         pr.username,
         coalesce(pr.theme, 'light'),
         p.body, p.image_path, p.created_at,
         (select count(*)::int from public.challenge_post_reactions r
            where r.post_id = p.id and r.kind = 'like'),
         (select count(*)::int from public.challenge_post_comments c where c.post_id = p.id),
         exists (select 1 from public.challenge_post_reactions r
                   where r.post_id = p.id and r.user_id = auth.uid() and r.kind = 'like'),
         p.user_id = auth.uid()
    from public.challenge_posts p
    left join public.profiles pr on pr.id = p.user_id
   where p.challenge_id = p_challenge
     and p.post_date = p_date
     and public.is_challenge_member(p_challenge)
   order by p.created_at asc;
$$;

drop function if exists public.challenge_post_comments_for(uuid);
create function public.challenge_post_comments_for(p_post uuid)
returns table (
  id uuid, user_id uuid, display_name text, username text,
  body text, created_at timestamptz,
  like_count int, my_like boolean, mine boolean
)
language sql security definer stable set search_path = public as $$
  select c.id, c.user_id,
         coalesce(pr.display_name, 'anonymous'),
         pr.username,
         c.body, c.created_at,
         (select count(*)::int from public.challenge_comment_reactions r
            where r.comment_id = c.id and r.kind = 'like'),
         exists (select 1 from public.challenge_comment_reactions r
                   where r.comment_id = c.id and r.user_id = auth.uid() and r.kind = 'like'),
         c.user_id = auth.uid()
    from public.challenge_post_comments c
    left join public.profiles pr on pr.id = c.user_id
    join public.challenge_posts p on p.id = c.post_id
   where c.post_id = p_post
     and public.is_challenge_member(p.challenge_id)
   order by c.created_at asc;
$$;

-- ---------------------------------------------------------------------------
-- 6. Storage: challenge-images bucket + policies
--    Path scheme: {challenge_id}/{user_id}/{filename}
--    Read: any member of that challenge.
--    Write/delete: only the author (folder owner).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
  values ('challenge-images', 'challenge-images', true)
  on conflict (id) do update set public = excluded.public;

-- Read: any member of the challenge whose id is the first path segment.
drop policy if exists "members read challenge images" on storage.objects;
create policy "members read challenge images" on storage.objects
  for select using (
    bucket_id = 'challenge-images'
    and public.is_challenge_member((split_part(name, '/', 1))::uuid)
  );

-- Insert: authed user uploads under {challenge_id}/{their_user_id}/...
drop policy if exists "members upload own challenge images" on storage.objects;
create policy "members upload own challenge images" on storage.objects
  for insert with check (
    bucket_id = 'challenge-images'
    and auth.uid() is not null
    and auth.uid()::text = split_part(name, '/', 2)
    and public.is_challenge_member((split_part(name, '/', 1))::uuid)
  );

-- Delete: only the object owner (author's user_id in the path).
drop policy if exists "members delete own challenge images" on storage.objects;
create policy "members delete own challenge images" on storage.objects
  for delete using (
    bucket_id = 'challenge-images'
    and auth.uid()::text = split_part(name, '/', 2)
  );

-- ---------------------------------------------------------------------------
-- 7. Realtime: publish the three feed tables so clients can subscribe.
-- ---------------------------------------------------------------------------

do $$
begin
  begin alter publication supabase_realtime add table public.challenge_posts;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.challenge_post_comments;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.challenge_post_reactions;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.challenge_comment_reactions;
  exception when duplicate_object then null; end;
end $$;
