-- DayMax migration 18: the demo universe reveals itself on the VIEWER'S clock,
-- not UTC. Postgres `current_date` is UTC, so at 00:54 in Sydney the legends'
-- day was still stuck on yesterday afternoon — the same off-by-a-timezone bug
-- the client had with toISOString(). We store each viewer's IANA timezone and
-- gate on their local time instead.

alter table public.profiles add column if not exists timezone text;

-- The signed-in viewer's local date/time, falling back to UTC if we've never
-- seen their timezone (or it's a name Postgres doesn't recognise).
create or replace function public.viewer_local_ts()
returns timestamp language plpgsql security definer stable set search_path = public as $$
declare
  tz text;
begin
  select p.timezone into tz from public.profiles p where p.id = auth.uid();
  if tz is null or tz = '' then
    return (now() at time zone 'UTC');
  end if;
  begin
    return (now() at time zone tz);
  exception when others then
    return (now() at time zone 'UTC');
  end;
end $$;

create or replace function public.demo_row_visible(u uuid, d date, s smallint)
returns boolean language plpgsql security definer stable set search_path = public as $$
declare
  local_ts timestamp := public.viewer_local_ts();
  local_day date := local_ts::date;
begin
  if not exists (select 1 from public.profiles p where p.id = u and p.is_demo) then
    return true;
  end if;
  if d < local_day then
    return true;
  end if;
  if d = local_day then
    return s <= (extract(hour from local_ts)::int * 4 + extract(minute from local_ts)::int / 15);
  end if;
  return false;
end $$;

create or replace function public.demo_date_visible(u uuid, d date)
returns boolean language plpgsql security definer stable set search_path = public as $$
begin
  return not exists (select 1 from public.profiles p where p.id = u and p.is_demo)
      or d < public.viewer_local_ts()::date;
end $$;
