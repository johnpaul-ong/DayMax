-- DayMax migration 45: template + config on pursuits.
--
-- The generic pursuit renderer at /pursuits/[id] handles every custom pursuit
-- as tabular daily stats (a set of `pursuit_stats` rows with numeric daily
-- entries). Some pursuits genuinely aren't that shape — chess is per-game
-- data from a 3rd-party API rendered as a review board — and previously
-- lived as a standalone /chess page. This migration adds an escape hatch:
--
--   * `template` (nullable) — a discriminator on `public.pursuits`. When set
--     to 'chess' (currently the only value), the renderer dispatches to a
--     bespoke chess view instead of the generic stats renderer. NULL means
--     "standard, use the generic renderer" — every existing row stays that
--     way (default null, no data migration needed).
--
--   * `config` (jsonb) — per-pursuit template-specific settings. For the
--     chess template that's `{ username, opponents, monthsBack }`. For any
--     future template it's whatever that template needs. Loose jsonb so a
--     template can evolve without needing another migration.
--
-- Both columns are readable/writable under the EXISTING pursuit RLS policies
-- from migration 13 (SELECT `visible pursuits`, UPDATE `owner updates
-- pursuit`) — the columns are just extra data on a row those policies
-- already cover.

alter table public.pursuits
  add column if not exists template text,
  add column if not exists config jsonb not null default '{}'::jsonb;

comment on column public.pursuits.template is
  'Optional bespoke renderer for /pursuits/[id]. NULL = standard tabular stats. Known values: ''chess''.';
comment on column public.pursuits.config is
  'Per-pursuit template settings. Shape depends on template. Empty object when no template.';
