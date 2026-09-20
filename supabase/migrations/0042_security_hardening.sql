-- DayMax migration 42: security hardening from the parallel red-team review.
--
-- Fixes:
--   1. REVOKE public.emit_notification from anon/authenticated. Left
--      unrevoked in 0040 (documented invariant was "clients never call
--      this"; the invariant was one REVOKE short of being enforced).
--   2. challenge_members INSERT policy: 0035 was `for all with check
--      user_id = auth.uid()` -- any signed-in user who learned a
--      challenge_id could self-INSERT into a private challenge and
--      unlock standings, posts, comments, and images. Split into
--      distinct SELECT/INSERT/UPDATE/DELETE policies with the INSERT
--      requiring public challenge OR ownership OR a valid outstanding
--      invite. The freeze_challenge_membership trigger from 0038
--      handles re-parenting on UPDATE.
--   3. Add freeze_challenge_post_comment trigger so a member of
--      challenge A cannot UPDATE their own comment's post_id to a
--      post in challenge B. Same class of bug 0030 documented and
--      that 0041 accidentally left open.
--   4. Extend freeze_challenge_post to also pin post_date and reject
--      image_path swaps to paths not owned by the author.
--   5. challenge-images bucket goes private (public = false). Client
--      switches to storage.createSignedUrl. A leaked public URL
--      previously exposed private-challenge photos to anyone.

-- ---------------------------------------------------------------------------
-- 1. Lock emit_notification down to internal callers only
-- ---------------------------------------------------------------------------

revoke all on function public.emit_notification(uuid, text, text, text, text, uuid, jsonb) from public, anon, authenticated;
-- Triggers that call it run as SECURITY DEFINER themselves and don't
-- rely on the caller's grant, so they keep working. The three RPCs
-- the client DOES call (mark_notification_read, mark_all_notifications_read,
-- unread_notification_count, my_notifications) stay callable.

-- ---------------------------------------------------------------------------
-- 2. Split challenge_members policies; block private self-INSERT
-- ---------------------------------------------------------------------------

drop policy if exists "join or leave yourself" on public.challenge_members;
drop policy if exists "read challenge members" on public.challenge_members;
drop policy if exists "insert own membership" on public.challenge_members;
drop policy if exists "update own membership" on public.challenge_members;
drop policy if exists "delete own membership" on public.challenge_members;

create policy "read challenge members" on public.challenge_members
  for select using (
    -- see rosters of challenges you own or you're in, plus public ones
    user_id = auth.uid()
    or exists (
      select 1 from public.challenges c
       where c.id = challenge_id
         and (c.is_public or c.owner_id = auth.uid() or public.is_challenge_member(c.id))
    )
  );

create policy "insert own membership" on public.challenge_members
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.challenges c
       where c.id = challenge_id
         and (
           c.is_public
           or c.owner_id = auth.uid()
           or exists (
             select 1 from public.challenge_invites i
              where i.challenge_id = c.id and i.invited_user = auth.uid()
           )
         )
    )
  );

create policy "update own membership" on public.challenge_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "delete own membership" on public.challenge_members
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Freeze challenge_post_comments on UPDATE (0030 regression fix)
-- ---------------------------------------------------------------------------

create or replace function public.freeze_challenge_post_comment()
returns trigger language plpgsql as $$
begin
  if new.post_id <> old.post_id or new.user_id <> old.user_id then
    raise exception 'Cannot re-parent a comment';
  end if;
  return new;
end $$;
drop trigger if exists freeze_challenge_post_comment on public.challenge_post_comments;
create trigger freeze_challenge_post_comment before update on public.challenge_post_comments
  for each row execute function public.freeze_challenge_post_comment();

-- ---------------------------------------------------------------------------
-- 4. Extend post freeze: also pin post_date and image_path prefix
-- ---------------------------------------------------------------------------

create or replace function public.freeze_challenge_post()
returns trigger language plpgsql as $$
begin
  if new.challenge_id <> old.challenge_id or new.user_id <> old.user_id then
    raise exception 'Cannot re-parent a post';
  end if;
  if new.post_date <> old.post_date then
    raise exception 'Cannot move a post to a different day';
  end if;
  -- image_path must stay under the author's own folder for this
  -- challenge (matches the storage RLS path scheme). Null is fine
  -- (removing an image); a non-null value must match the prefix.
  if new.image_path is not null
     and new.image_path not like (new.challenge_id::text || '/' || new.user_id::text || '/%') then
    raise exception 'image_path must live under this challenge and author folder';
  end if;
  return new;
end $$;
-- Trigger already exists from 0041; the CREATE OR REPLACE above rewires it.

-- ---------------------------------------------------------------------------
-- 5. Storage: challenge-images goes private, reads switch to signed URLs
-- ---------------------------------------------------------------------------

update storage.buckets set public = false where id = 'challenge-images';

-- The existing SELECT / INSERT / DELETE policies on storage.objects
-- (from 0041) already restrict by challenge membership and path
-- owner. With public = false, a leaked URL is no longer readable;
-- the client uses createSignedUrl (short-lived) which respects RLS
-- via the auth token.

-- ---------------------------------------------------------------------------
-- 6. Backfill guard: any orphaned membership rows created before this
--    migration are LEFT ALONE (audit only). Delete manually if needed.
-- ---------------------------------------------------------------------------

-- select ...  -- intentional no-op; keep audit as a note, not a
-- destructive delete.
