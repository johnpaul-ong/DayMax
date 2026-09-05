-- DayMax migration 15: owners style their pursuit pages —
-- chart type per stat (line/bar/pie) and hideable graphs.
alter table public.pursuit_stats
  add column if not exists chart text not null default 'line' check (chart in ('line', 'bar', 'pie')),
  add column if not exists hidden boolean not null default false;
