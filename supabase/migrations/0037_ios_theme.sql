-- DayMax migration 37: the iOS theme, and therefore a fourth team.
--
-- profiles.theme is checked against the list of themes (migration 27), and the
-- team IS the theme, so a new look cannot ship without widening the constraint
-- first — otherwise Settings → Appearance saves silently fail for anyone who
-- picks it. Nothing else changes: the standings functions group by
-- profiles.theme rather than enumerating teams, so 'ios' flows through
-- pursuit_team_standings, team_totals and arena_day_totals unaltered.
--
-- No data is migrated and the default stays 'light'.

alter table public.profiles drop constraint if exists profiles_theme_check;
alter table public.profiles
  add constraint profiles_theme_check check (theme in ('light', 'dark', 'cottage', 'ios'));
