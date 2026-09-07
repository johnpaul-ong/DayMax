-- DayMax migration 33: Web Push subscriptions, and deciding who is actually
-- due a prompt.
--
-- The point of this is NOT to ping everyone every 15 minutes. That's how a
-- notification gets muted on day two. push_due() only returns people who:
--   * turned it on,
--   * are inside their own waking hours in their own timezone,
--   * and have NOT already logged the slot that just closed.
--
-- Someone who logs diligently should barely ever hear from us. The prompt is
-- for the slot you forgot, not the slot you filled.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  -- consecutive failures; the sender prunes a subscription that keeps 410-ing
  failures int not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- per-account push preferences (the widget's own settings stay in localStorage,
-- but the SERVER needs these to decide whether to send)
alter table public.profiles add column if not exists push_enabled boolean not null default false;
alter table public.profiles add column if not exists push_quiet_from smallint not null default 22;
alter table public.profiles add column if not exists push_quiet_to smallint not null default 7;
-- don't prompt more often than this, in minutes
alter table public.profiles add column if not exists push_min_gap_min smallint not null default 15;

/**
 * Everyone due a prompt right now.
 *
 * Called by the scheduled Edge Function with the service role, so it is NOT
 * exposed to normal users — hence the explicit revoke at the bottom.
 */
create or replace function public.push_due()
returns table (
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  slot_label text,
  missed int
)
language plpgsql security definer stable set search_path = public as $$
begin
  return query
  with people as (
    select p.id,
           s.id as sub_id, s.endpoint, s.p256dh, s.auth, s.last_sent_at,
           p.push_quiet_from, p.push_quiet_to, p.push_min_gap_min,
           -- their local clock, not the server's
           (now() at time zone coalesce(nullif(p.timezone, ''), 'UTC')) as local_ts
    from public.profiles p
    join public.push_subscriptions s on s.user_id = p.id
    where p.push_enabled
      and coalesce(p.is_demo, false) = false
      and s.failures < 5
  ),
  timed as (
    select *,
           local_ts::date as local_day,
           extract(hour from local_ts)::int as local_hour,
           -- the slot that just CLOSED, not the one in progress
           (extract(hour from local_ts)::int * 4 + extract(minute from local_ts)::int / 15) - 1 as closed_slot
    from people
  ),
  awake as (
    select * from timed
    where closed_slot >= 0
      -- quiet hours, wrapping midnight
      and case when push_quiet_from = push_quiet_to then true
               when push_quiet_from < push_quiet_to
                 then not (local_hour >= push_quiet_from and local_hour < push_quiet_to)
               else not (local_hour >= push_quiet_from or local_hour < push_quiet_to)
          end
      -- respect their minimum gap so we can run the cron more often than we send
      and (last_sent_at is null or last_sent_at < now() - make_interval(mins => push_min_gap_min))
  )
  select a.sub_id,
         a.endpoint,
         a.p256dh,
         a.auth,
         to_char(make_time(a.closed_slot / 4, (a.closed_slot % 4) * 15, 0), 'HH24:MI'),
         -- how many of the last two hours are unlogged: shapes the wording
         (select count(*)::int
            from generate_series(greatest(0, a.closed_slot - 7), a.closed_slot) g
           where not exists (
             select 1 from public.day_entries e
             where e.user_id = a.id and e.date = a.local_day and e.slot = g
           ))
  from awake a
  -- the slot that just closed is still empty -> they forgot it
  where not exists (
    select 1 from public.day_entries e
    where e.user_id = a.id and e.date = a.local_day and e.slot = a.closed_slot
  );
end $$;

revoke all on function public.push_due() from anon, authenticated;

/** The sender calls this after a successful/failed send. */
create or replace function public.push_mark(sub uuid, ok boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if ok then
    update public.push_subscriptions set last_sent_at = now(), failures = 0 where id = sub;
  else
    update public.push_subscriptions set failures = failures + 1 where id = sub;
    delete from public.push_subscriptions where id = sub and failures >= 5;
  end if;
end $$;

revoke all on function public.push_mark(uuid, boolean) from anon, authenticated;
