-- DayMax migration 43: drop 'ios' from profiles.theme.
--
-- Migration 0037 added 'ios' to the theme check constraint back when iOS
-- was a theme. It was demoted to "just a feel" a while ago -- the client
-- normalises 'ios' -> 'light' on read (src/lib/theme.ts normaliseTheme()),
-- but the value can still be stored, so a returning user hits the coerce
-- path on every page load. Rewriting the row + tightening the constraint
-- removes the drift.
--
-- Idempotent. Safe to re-run.

update public.profiles set theme = 'light' where theme = 'ios';

alter table public.profiles drop constraint if exists profiles_theme_check;
alter table public.profiles
  add constraint profiles_theme_check check (theme in ('light', 'dark', 'cottage'));
