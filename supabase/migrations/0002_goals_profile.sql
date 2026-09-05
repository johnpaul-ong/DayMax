-- DayMax migration 2: lift goals + profile extras (birthday, country).
-- Paste into Supabase SQL Editor and Run (safe to run once).

-- profile extras for the "life lived" card ----------------------------------
alter table public.profiles
  add column if not exists birth_date date,
  add column if not exists country text;

-- lift goals ------------------------------------------------------------------
create table public.lift_goals (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise text not null,
  target_weight_kg numeric not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, exercise)
);
alter table public.lift_goals enable row level security;
create policy "own lift goals" on public.lift_goals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
