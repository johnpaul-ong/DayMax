-- DayMax migration 3: goals can target kg OR reps (e.g. 100 push-ups).
alter table public.lift_goals
  add column if not exists unit text not null default 'kg' check (unit in ('kg', 'reps'));
