-- DayMax v1 schema. Run in Supabase SQL editor (or `supabase db push`).
-- Every table has RLS: you can only touch rows where user_id = auth.uid().
-- Friend/membership tables come in Phase 3; the schema here is single-user-safe.

-- profiles ------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- auto-create profile on signup
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1));
  return new;
end $$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- day entries: one row per 15-minute slot -----------------------------------
create table public.day_entries (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  slot smallint not null check (slot between 0 and 95),
  category smallint not null check (category between 0 and 9),
  label text,
  updated_at timestamptz not null default now(),
  primary key (user_id, date, slot)
);
alter table public.day_entries enable row level security;
create policy "own day entries" on public.day_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index day_entries_date_idx on public.day_entries (user_id, date);

-- per-day metrics (emotional score, tired, notes, ...) ----------------------
create table public.day_metrics (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  emotional_score numeric,
  tired numeric,
  start_friction numeric,
  end_brain_fatigue numeric,
  deep_time numeric,
  weight_kg numeric,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);
alter table public.day_metrics enable row level security;
create policy "own day metrics" on public.day_metrics
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- lift entries: one exercise per row ----------------------------------------
create table public.lift_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  exercise text not null,
  weight_kg numeric,
  reps text,          -- text on purpose: "2", "AMRAP", "2 + 10"
  sets smallint,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.lift_entries enable row level security;
create policy "own lifts" on public.lift_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index lift_entries_date_idx on public.lift_entries (user_id, date);
create index lift_entries_exercise_idx on public.lift_entries (user_id, exercise);

-- daily numeric metrics (bodyweight, run time, tuna rice, ...) --------------
create table public.daily_metrics (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  metric text not null,
  value numeric,
  text_value text,
  updated_at timestamptz not null default now(),
  primary key (user_id, date, metric)
);
alter table public.daily_metrics enable row level security;
create policy "own daily metrics" on public.daily_metrics
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ranking bucket settings per user (defaults applied in app code) -----------
create table public.bucket_settings (
  user_id uuid not null references auth.users (id) on delete cascade,
  category smallint not null check (category between 0 and 9),
  bucket text not null check (bucket in ('productive', 'brainrot', 'other')),
  primary key (user_id, category)
);
alter table public.bucket_settings enable row level security;
create policy "own bucket settings" on public.bucket_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
