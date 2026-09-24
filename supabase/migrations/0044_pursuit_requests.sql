-- DayMax migration 44: pursuit REQUESTS queue.
--
-- People file short "I want a pursuit for X" requests. The DayMax admin
-- (see admins table below) reviews the queue and, when a request is worth
-- building, briefs a coding session to ship it as real code — no
-- user-generated code ever runs in the app. When the pursuit lands,
-- implemented_pursuit_id points back at the finished pursuit and the
-- request flips to 'implemented' so the requester can see the outcome.
--
-- SECURITY:
--   * A user can only see + write their own requests.
--   * The admin can see + update every request, and delete (rare).
--   * Admin identity lives in a tiny public.admins table rather than a
--     GUC or an env var — Postgres RLS cannot read Next env vars, and
--     baking a specific uid into the migration would make the schema
--     environment-specific. Ops seeds `insert into admins (user_id)
--     values ('<uid>')` per environment.

-- ---------------------------------------------------------------------------
-- 1. Admin registry
-- ---------------------------------------------------------------------------

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now()
);
alter table public.admins enable row level security;

-- Only an admin sees the admins table (recursion is fine — the function
-- below is security-definer and reads the table itself, bypassing RLS on
-- its own read).
create policy "admins see admins" on public.admins
  for select using (public.is_daymax_admin());

create or replace function public.is_daymax_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

grant execute on function public.is_daymax_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Requests table
-- ---------------------------------------------------------------------------

create table if not exists public.pursuit_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sentence text not null check (length(trim(sentence)) between 1 and 500),
  context text check (context is null or length(context) <= 4000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'implemented')),
  reviewer_notes text,       -- admin-private
  reviewer_response text,    -- visible to requester
  implemented_pursuit_id uuid references public.pursuits (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pursuit_requests_user_idx on public.pursuit_requests (user_id, created_at desc);
create index if not exists pursuit_requests_status_idx on public.pursuit_requests (status, created_at desc);

alter table public.pursuit_requests enable row level security;

-- INSERT: a signed-in user files a request as themselves.
create policy "user inserts own request" on public.pursuit_requests
  for insert with check (user_id = auth.uid());

-- SELECT: user sees own; admin sees all.
create policy "user selects own request" on public.pursuit_requests
  for select using (user_id = auth.uid() or public.is_daymax_admin());

-- UPDATE: only admin. Users can't edit after submission (keeps the review
-- audit clean; if they need to add detail, they file another request).
create policy "admin updates request" on public.pursuit_requests
  for update using (public.is_daymax_admin()) with check (public.is_daymax_admin());

-- DELETE: only admin. Rare; used for spam.
create policy "admin deletes request" on public.pursuit_requests
  for delete using (public.is_daymax_admin());

-- ---------------------------------------------------------------------------
-- 3. updated_at trigger
-- ---------------------------------------------------------------------------
-- Bumped in server code today would work, but a trigger is the safe belt-and-
-- braces: any UPDATE from the admin UI, the SQL editor, or a future RPC keeps
-- the timestamp honest without ceremony.

create or replace function public.pursuit_requests_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pursuit_requests_touch_updated_at on public.pursuit_requests;
create trigger pursuit_requests_touch_updated_at
  before update on public.pursuit_requests
  for each row execute function public.pursuit_requests_touch_updated_at();
