-- DayMax migration 4: target bodyweight for the standardized lifts graph.
alter table public.profiles
  add column if not exists target_weight_kg numeric;
