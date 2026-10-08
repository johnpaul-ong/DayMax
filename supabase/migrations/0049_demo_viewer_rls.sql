-- Demo viewer: lets the shared demo account (demo@daymax.app) SELECT the
-- owner's rows on tables that drive /today, /overview, year strip, pursuits
-- and lifts, so a "Try it as a visitor" session shows the owner's live data
-- instead of an empty demo profile. Writes stay strict — demo can only
-- INSERT/UPDATE/DELETE its own rows (which stay empty / get scribbled on
-- and never affect the owner).
--
-- Why RLS impersonation vs. data mirror: no sync job, no UUID remapping, no
-- stale snapshots. The demo user auths normally; policies just widen SELECT.
--
-- Keyed on the demo user's email in the JWT, not a hardcoded uid, so you
-- can rotate the demo account without another migration. Owner uid IS
-- hardcoded (it's a one-person demo); change the constant and re-run.

create or replace function public.daymax_demo_owner_uid()
returns uuid
language sql
immutable
as $$
  select 'c04b76dd-5bba-4ee7-a3d0-d9fbf5fab2a8'::uuid
$$;

create or replace function public.daymax_is_demo_viewer()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'demo@daymax.app'
$$;

-- Table-by-table: drop the single "for all" policy, split into
-- (SELECT = own OR demo-viewing-owner) + (INSERT/UPDATE/DELETE = strictly own).

-- day_entries ---------------------------------------------------------------
drop policy if exists "own day entries" on public.day_entries;
create policy "read day entries" on public.day_entries
  for select using (
    user_id = auth.uid()
    or (public.daymax_is_demo_viewer() and user_id = public.daymax_demo_owner_uid())
  );
create policy "write own day entries" on public.day_entries
  for insert with check (user_id = auth.uid());
create policy "update own day entries" on public.day_entries
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own day entries" on public.day_entries
  for delete using (user_id = auth.uid());

-- day_metrics ---------------------------------------------------------------
drop policy if exists "own day metrics" on public.day_metrics;
create policy "read day metrics" on public.day_metrics
  for select using (
    user_id = auth.uid()
    or (public.daymax_is_demo_viewer() and user_id = public.daymax_demo_owner_uid())
  );
create policy "write own day metrics" on public.day_metrics
  for insert with check (user_id = auth.uid());
create policy "update own day metrics" on public.day_metrics
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own day metrics" on public.day_metrics
  for delete using (user_id = auth.uid());

-- daily_metrics -------------------------------------------------------------
drop policy if exists "own daily metrics" on public.daily_metrics;
create policy "read daily metrics" on public.daily_metrics
  for select using (
    user_id = auth.uid()
    or (public.daymax_is_demo_viewer() and user_id = public.daymax_demo_owner_uid())
  );
create policy "write own daily metrics" on public.daily_metrics
  for insert with check (user_id = auth.uid());
create policy "update own daily metrics" on public.daily_metrics
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own daily metrics" on public.daily_metrics
  for delete using (user_id = auth.uid());

-- bucket_settings -----------------------------------------------------------
drop policy if exists "own bucket settings" on public.bucket_settings;
create policy "read bucket settings" on public.bucket_settings
  for select using (
    user_id = auth.uid()
    or (public.daymax_is_demo_viewer() and user_id = public.daymax_demo_owner_uid())
  );
create policy "write own bucket settings" on public.bucket_settings
  for insert with check (user_id = auth.uid());
create policy "update own bucket settings" on public.bucket_settings
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own bucket settings" on public.bucket_settings
  for delete using (user_id = auth.uid());

-- lift_entries --------------------------------------------------------------
drop policy if exists "own lifts" on public.lift_entries;
create policy "read lifts" on public.lift_entries
  for select using (
    user_id = auth.uid()
    or (public.daymax_is_demo_viewer() and user_id = public.daymax_demo_owner_uid())
  );
create policy "write own lifts" on public.lift_entries
  for insert with check (user_id = auth.uid());
create policy "update own lifts" on public.lift_entries
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own lifts" on public.lift_entries
  for delete using (user_id = auth.uid());

-- lift_goals ----------------------------------------------------------------
drop policy if exists "own lift goals" on public.lift_goals;
create policy "read lift goals" on public.lift_goals
  for select using (
    user_id = auth.uid()
    or (public.daymax_is_demo_viewer() and user_id = public.daymax_demo_owner_uid())
  );
create policy "write own lift goals" on public.lift_goals
  for insert with check (user_id = auth.uid());
create policy "update own lift goals" on public.lift_goals
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own lift goals" on public.lift_goals
  for delete using (user_id = auth.uid());

-- pursuit_entries -----------------------------------------------------------
-- The "own entries" policy was redefined in 0030 with a longer with-check;
-- preserve that strict write check, only widen SELECT.
drop policy if exists "own entries" on public.pursuit_entries;
create policy "read pursuit entries" on public.pursuit_entries
  for select using (
    user_id = auth.uid()
    or (public.daymax_is_demo_viewer() and user_id = public.daymax_demo_owner_uid())
  );
create policy "write own pursuit entries" on public.pursuit_entries
  for insert with check (user_id = auth.uid());
create policy "update own pursuit entries" on public.pursuit_entries
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own pursuit entries" on public.pursuit_entries
  for delete using (user_id = auth.uid());

-- pursuits ------------------------------------------------------------------
-- Existing visible-pursuits policy already allows public + member reads.
-- Add a parallel policy so the demo viewer sees your private pursuits too.
create policy "demo viewer reads owner pursuits" on public.pursuits
  for select using (
    public.daymax_is_demo_viewer() and owner_id = public.daymax_demo_owner_uid()
  );
