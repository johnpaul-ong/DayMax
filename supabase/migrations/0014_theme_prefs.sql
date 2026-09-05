-- DayMax migration 14: theme follows the account, not the device.
alter table public.profiles
  add column if not exists theme text check (theme in ('light', 'dark', 'ghibli')),
  add column if not exists accent text;
