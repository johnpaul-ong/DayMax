-- Demo visitor v2: snapshot mirror + hard write-block.
--
-- Supersedes the RLS-impersonation approach from 0049 (which caused
-- query lag because of per-row OR evaluation, and still left many
-- auth.uid()-filtered RPCs returning demo's empty rows). This version:
--
--   1. Reverts the "read as demo viewer" permissive policies from 0049,
--      restoring the original tight "user_id = auth.uid()" policies on
--      the affected tables. No more OR clause, no more per-row function
--      calls on hot reads.
--   2. Snapshots the owner's rows into the demo account for the simple
--      user-owned tables that drive /today, /overview, year strip and
--      lifts. One-shot copy in this migration; run the snapshot RPC
--      again later to refresh. The daymax_sync_demo_from_owner from
--      0050 keeps running on each visitor click for the profile
--      identity + challenge membership.
--   3. Blocks demo from writing to anything via RESTRICTIVE policies —
--      visitor cannot modify any row, period. Writes don't even hit
--      the application layer.
--
-- Pursuits/challenge content are NOT snapshotted here (pursuits have
-- uuid pks with child tables that would need remapping). Visitor sees
-- empty pursuits list. Add a 0052 later if that gap bites.

-- --- 1. Revert 0049's permissive read-as-demo policies ----------------------

drop policy if exists "read day entries" on public.day_entries;
drop policy if exists "write own day entries" on public.day_entries;
drop policy if exists "update own day entries" on public.day_entries;
drop policy if exists "delete own day entries" on public.day_entries;
create policy "own day entries" on public.day_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "read day metrics" on public.day_metrics;
drop policy if exists "write own day metrics" on public.day_metrics;
drop policy if exists "update own day metrics" on public.day_metrics;
drop policy if exists "delete own day metrics" on public.day_metrics;
create policy "own day metrics" on public.day_metrics
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "read daily metrics" on public.daily_metrics;
drop policy if exists "write own daily metrics" on public.daily_metrics;
drop policy if exists "update own daily metrics" on public.daily_metrics;
drop policy if exists "delete own daily metrics" on public.daily_metrics;
create policy "own daily metrics" on public.daily_metrics
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "read bucket settings" on public.bucket_settings;
drop policy if exists "write own bucket settings" on public.bucket_settings;
drop policy if exists "update own bucket settings" on public.bucket_settings;
drop policy if exists "delete own bucket settings" on public.bucket_settings;
create policy "own bucket settings" on public.bucket_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "read lifts" on public.lift_entries;
drop policy if exists "write own lifts" on public.lift_entries;
drop policy if exists "update own lifts" on public.lift_entries;
drop policy if exists "delete own lifts" on public.lift_entries;
create policy "own lifts" on public.lift_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "read lift goals" on public.lift_goals;
drop policy if exists "write own lift goals" on public.lift_goals;
drop policy if exists "update own lift goals" on public.lift_goals;
drop policy if exists "delete own lift goals" on public.lift_goals;
create policy "own lift goals" on public.lift_goals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "read pursuit entries" on public.pursuit_entries;
drop policy if exists "write own pursuit entries" on public.pursuit_entries;
drop policy if exists "update own pursuit entries" on public.pursuit_entries;
drop policy if exists "delete own pursuit entries" on public.pursuit_entries;
-- Original from 0030 (strict with-check for pursuit_stats ownership) —
-- preserve by restoring the exact 0030 version.
create policy "own entries" on public.pursuit_entries
  for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.pursuit_stats s
       join public.pursuits p on p.id = s.pursuit_id
      where s.id = pursuit_entries.stat_id
        and (p.is_public or p.owner_id is null or p.owner_id = auth.uid() or public.is_pursuit_member(p.id))
    )
  );

drop policy if exists "demo viewer reads owner pursuits" on public.pursuits;

-- --- 2. Snapshot function + one-shot copy ----------------------------------

create or replace function public.daymax_snapshot_demo_from_owner()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := public.daymax_demo_owner_uid();
  demo  uuid;
begin
  select id into demo from auth.users where email = 'demo@daymax.app';
  if demo is null then
    return;
  end if;

  -- Snapshot caller gate: when invoked from a user session, require it
  -- to be the demo user. When invoked bare (no auth.uid, like the
  -- one-shot below from the migration), allow it.
  if auth.uid() is not null and auth.uid() is distinct from demo then
    raise exception 'daymax_snapshot_demo_from_owner can only be invoked by the demo account';
  end if;

  -- Simple user_id tables: wipe demo's rows, copy owner's with user_id
  -- remapped. Explicit column lists so a future ALTER TABLE ADD COLUMN
  -- without updating this function doesn't silently drop or misalign a
  -- field. identity-pk tables (lift_entries, lift_goals) skip id so the
  -- sequence picks a fresh one.

  delete from public.day_entries where user_id = demo;
  insert into public.day_entries (user_id, date, slot, category, label, updated_at)
    select demo, date, slot, category, label, updated_at
      from public.day_entries where user_id = owner;

  delete from public.day_metrics where user_id = demo;
  insert into public.day_metrics
    (user_id, date, emotional_score, tired, start_friction, end_brain_fatigue,
     deep_time, weight_kg, notes, updated_at)
    select demo, date, emotional_score, tired, start_friction, end_brain_fatigue,
           deep_time, weight_kg, notes, updated_at
      from public.day_metrics where user_id = owner;

  delete from public.daily_metrics where user_id = demo;
  insert into public.daily_metrics (user_id, date, metric, value, text_value, updated_at)
    select demo, date, metric, value, text_value, updated_at
      from public.daily_metrics where user_id = owner;

  delete from public.bucket_settings where user_id = demo;
  insert into public.bucket_settings (user_id, category, bucket)
    select demo, category, bucket
      from public.bucket_settings where user_id = owner;

  delete from public.lift_entries where user_id = demo;
  insert into public.lift_entries (user_id, date, exercise, weight_kg, reps, sets, notes, created_at)
    select demo, date, exercise, weight_kg, reps, sets, notes, created_at
      from public.lift_entries where user_id = owner;

  delete from public.lift_goals where user_id = demo;
  insert into public.lift_goals (user_id, exercise, target_weight_kg, archived, created_at)
    select demo, exercise, target_weight_kg, archived, created_at
      from public.lift_goals where user_id = owner;
end
$$;

grant execute on function public.daymax_snapshot_demo_from_owner() to authenticated;

-- Run the one-shot copy. If the demo account doesn't exist yet, no-op.
select public.daymax_snapshot_demo_from_owner();

-- --- 3. Block demo writes everywhere ---------------------------------------
-- RESTRICTIVE policies AND with the existing permissive policies, so a
-- demo-user INSERT/UPDATE/DELETE is refused even when the ordinary RLS
-- would allow it. Reads still flow normally.

do $$
declare
  tbl text;
  tables text[] := array[
    'day_entries', 'day_metrics', 'daily_metrics', 'bucket_settings',
    'lift_entries', 'lift_goals', 'profiles', 'pursuits',
    'pursuit_members', 'pursuit_entries', 'pursuit_stats',
    'tracks', 'track_members', 'track_posts', 'track_comments',
    'friendships', 'invites', 'push_subscriptions',
    'spend_categories', 'spend_category_prefs', 'spend_entries', 'income_entries',
    'challenges', 'challenge_members', 'challenge_results', 'challenge_posts',
    'challenge_post_reactions', 'challenge_post_comments', 'challenge_comment_reactions',
    'challenge_invites', 'notifications'
  ];
begin
  foreach tbl in array tables loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = tbl) then
      execute format('drop policy if exists "demo cannot insert" on public.%I', tbl);
      execute format('drop policy if exists "demo cannot update" on public.%I', tbl);
      execute format('drop policy if exists "demo cannot delete" on public.%I', tbl);
      execute format('create policy "demo cannot insert" on public.%I as restrictive for insert with check (not public.daymax_is_demo_viewer())', tbl);
      execute format('create policy "demo cannot update" on public.%I as restrictive for update using (not public.daymax_is_demo_viewer()) with check (not public.daymax_is_demo_viewer())', tbl);
      execute format('create policy "demo cannot delete" on public.%I as restrictive for delete using (not public.daymax_is_demo_viewer())', tbl);
    end if;
  end loop;
end $$;
