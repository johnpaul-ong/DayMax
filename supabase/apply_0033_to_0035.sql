-- ============================================================================
-- DayMax — migrations 0033 to 0035
--
--   0033  Web Push subscriptions (from the last round)
--   0034  Money: spending, income, categories, essential/non-essential
--   0035  Challenges: time-boxed competitions with frozen results,
--         including "30 Days, Less Spent" (15 Sep -> 15 Oct 2026)
--
-- Wrapped in a transaction: if anything fails, nothing changes.
-- ============================================================================

begin;
set local statement_timeout = '120s';


-- ==========================================================================
-- 0033_push_subscriptions.sql
-- ==========================================================================
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


-- ==========================================================================
-- 0034_money.sql
-- ==========================================================================
-- DayMax migration 34: Money — spending, income, and what counts as essential.
--
-- Why this isn't a pursuit_stat: a stat is one number per day. Spending is a
-- list of items, each with its own amount, category and date, and the whole
-- point is slicing it — essential vs not, this category vs that. That needs
-- real rows.
--
-- The essential/non-essential split is the spine of the feature, and it is
-- SUBJECTIVE. A gym membership is essential to one person and the first thing
-- another would cut. So the defaults ship with an opinion, and every user can
-- override any of them for themselves without affecting anyone else.

-- 1. Categories ---------------------------------------------------------------
-- user_id null = a built-in everyone sees. Users add their own alongside.

create table if not exists public.spend_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  grp text not null default 'Other',
  essential boolean not null default false,
  color text,
  sort smallint not null default 100,
  created_at timestamptz not null default now()
);
create index if not exists spend_categories_user_idx on public.spend_categories (user_id, sort);
create unique index if not exists spend_categories_own_name_idx
  on public.spend_categories (user_id, lower(name)) where user_id is not null;
alter table public.spend_categories enable row level security;

drop policy if exists "see builtins and own" on public.spend_categories;
create policy "see builtins and own" on public.spend_categories
  for select using (user_id is null or user_id = auth.uid());
drop policy if exists "manage own categories" on public.spend_categories;
create policy "manage own categories" on public.spend_categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- personal override of a built-in's essential flag, or hiding one you never use
create table if not exists public.spend_category_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null references public.spend_categories (id) on delete cascade,
  essential boolean,
  hidden boolean not null default false,
  primary key (user_id, category_id)
);
alter table public.spend_category_prefs enable row level security;
drop policy if exists "own prefs" on public.spend_category_prefs;
create policy "own prefs" on public.spend_category_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2. The built-in set ----------------------------------------------------------
-- Opinionated but conventional. "Essential" means: skipping it has consequences
-- beyond mild disappointment.

insert into public.spend_categories (id, user_id, name, grp, essential, sort) values
  -- Essentials
  ('55555555-0000-4000-8000-000000000001', null, 'Rent / Mortgage',     'Essentials', true, 10),
  ('55555555-0000-4000-8000-000000000002', null, 'Utilities',           'Essentials', true, 11),
  ('55555555-0000-4000-8000-000000000003', null, 'Internet & Phone',    'Essentials', true, 12),
  ('55555555-0000-4000-8000-000000000004', null, 'Groceries',           'Essentials', true, 13),
  ('55555555-0000-4000-8000-000000000005', null, 'Transport & Fuel',    'Essentials', true, 14),
  ('55555555-0000-4000-8000-000000000006', null, 'Car & Insurance',     'Essentials', true, 15),
  ('55555555-0000-4000-8000-000000000007', null, 'Health & Medicine',   'Essentials', true, 16),
  ('55555555-0000-4000-8000-000000000008', null, 'Debt repayment',      'Essentials', true, 17),
  ('55555555-0000-4000-8000-000000000009', null, 'Childcare & School',  'Essentials', true, 18),
  -- Subscriptions (their own group because people want them totalled together)
  ('55555555-0000-4000-8000-000000000010', null, 'Streaming',           'Subscriptions', false, 30),
  ('55555555-0000-4000-8000-000000000011', null, 'Gym & Fitness',       'Subscriptions', false, 31),
  ('55555555-0000-4000-8000-000000000012', null, 'Apps & Software',     'Subscriptions', false, 32),
  ('55555555-0000-4000-8000-000000000013', null, 'Other subscriptions', 'Subscriptions', false, 33),
  -- Lifestyle — the stuff a spending challenge is actually about
  ('55555555-0000-4000-8000-000000000020', null, 'Eating out',          'Lifestyle', false, 50),
  ('55555555-0000-4000-8000-000000000021', null, 'Coffee',              'Lifestyle', false, 51),
  ('55555555-0000-4000-8000-000000000022', null, 'Alcohol & Going out', 'Lifestyle', false, 52),
  ('55555555-0000-4000-8000-000000000023', null, 'Clothes & Shoes',     'Lifestyle', false, 53),
  ('55555555-0000-4000-8000-000000000024', null, 'Entertainment',       'Lifestyle', false, 54),
  ('55555555-0000-4000-8000-000000000025', null, 'Travel & Holidays',   'Lifestyle', false, 55),
  ('55555555-0000-4000-8000-000000000026', null, 'Hobbies',             'Lifestyle', false, 56),
  ('55555555-0000-4000-8000-000000000027', null, 'Personal care',       'Lifestyle', false, 57),
  ('55555555-0000-4000-8000-000000000028', null, 'Home & Furniture',    'Lifestyle', false, 58),
  ('55555555-0000-4000-8000-000000000029', null, 'Gifts & Giving',      'Lifestyle', false, 59),
  -- Other
  ('55555555-0000-4000-8000-000000000040', null, 'Savings & Investing', 'Other', true,  70),
  ('55555555-0000-4000-8000-000000000041', null, 'Fees & Charges',      'Other', true,  71),
  ('55555555-0000-4000-8000-000000000042', null, 'Uncategorised',       'Other', false, 99)
on conflict (id) do nothing;

-- 3. Spending -------------------------------------------------------------------

create table if not exists public.spend_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  amount numeric(12, 2) not null check (amount >= 0),
  category_id uuid references public.spend_categories (id) on delete set null,
  item text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists spend_entries_user_date_idx on public.spend_entries (user_id, date desc);
create index if not exists spend_entries_cat_idx on public.spend_entries (category_id);
alter table public.spend_entries enable row level security;
drop policy if exists "own spending" on public.spend_entries;
create policy "own spending" on public.spend_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 4. Income — needed for "% of money in", which is the only fair comparison ----

create table if not exists public.income_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  amount numeric(12, 2) not null check (amount >= 0),
  source text,
  created_at timestamptz not null default now()
);
create index if not exists income_entries_user_date_idx on public.income_entries (user_id, date desc);
alter table public.income_entries enable row level security;
drop policy if exists "own income" on public.income_entries;
create policy "own income" on public.income_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 5. Reading it back -------------------------------------------------------------

/** Your categories: built-ins plus your own, with your overrides applied. */
create or replace function public.my_spend_categories()
returns table (id uuid, name text, grp text, essential boolean, is_mine boolean, hidden boolean, sort smallint)
language sql security definer stable set search_path = public as $$
  select c.id, c.name, c.grp,
         coalesce(p.essential, c.essential),
         c.user_id is not null,
         coalesce(p.hidden, false),
         c.sort
  from public.spend_categories c
  left join public.spend_category_prefs p on p.category_id = c.id and p.user_id = auth.uid()
  where c.user_id is null or c.user_id = auth.uid()
  order by c.sort, c.name;
$$;

/** Totals for a window, split the way the challenge cares about. */
create or replace function public.spend_summary(from_date date, to_date date)
returns table (
  total numeric, essential numeric, non_essential numeric,
  income numeric, non_essential_pct numeric, entries bigint
)
language sql security definer stable set search_path = public as $$
  with mine as (
    select e.amount,
           coalesce(p.essential, c.essential, false) as is_essential
    from public.spend_entries e
    left join public.spend_categories c on c.id = e.category_id
    left join public.spend_category_prefs p on p.category_id = e.category_id and p.user_id = auth.uid()
    where e.user_id = auth.uid() and e.date between from_date and to_date
  ),
  inc as (
    select coalesce(sum(amount), 0) as amt from public.income_entries
    where user_id = auth.uid() and date between from_date and to_date
  )
  select coalesce(sum(amount), 0),
         coalesce(sum(amount) filter (where is_essential), 0),
         coalesce(sum(amount) filter (where not is_essential), 0),
         (select amt from inc),
         case when (select amt from inc) > 0
              then round(coalesce(sum(amount) filter (where not is_essential), 0) / (select amt from inc) * 100, 1)
              else null end,
         count(*)
  from mine;
$$;

/** Per-category totals for a window — what the pie chart reads. */
create or replace function public.spend_by_category(from_date date, to_date date)
returns table (category_id uuid, name text, grp text, essential boolean, total numeric, entries bigint)
language sql security definer stable set search_path = public as $$
  select e.category_id,
         coalesce(c.name, 'Uncategorised'),
         coalesce(c.grp, 'Other'),
         coalesce(p.essential, c.essential, false),
         sum(e.amount),
         count(*)
  from public.spend_entries e
  left join public.spend_categories c on c.id = e.category_id
  left join public.spend_category_prefs p on p.category_id = e.category_id and p.user_id = auth.uid()
  where e.user_id = auth.uid() and e.date between from_date and to_date
  group by 1, 2, 3, 4
  order by 5 desc;
$$;

/** Daily running totals, for the trend line. */
create or replace function public.spend_daily(from_date date, to_date date)
returns table (date date, total numeric, essential numeric, non_essential numeric)
language sql security definer stable set search_path = public as $$
  select e.date,
         sum(e.amount),
         coalesce(sum(e.amount) filter (where coalesce(p.essential, c.essential, false)), 0),
         coalesce(sum(e.amount) filter (where not coalesce(p.essential, c.essential, false)), 0)
  from public.spend_entries e
  left join public.spend_categories c on c.id = e.category_id
  left join public.spend_category_prefs p on p.category_id = e.category_id and p.user_id = auth.uid()
  where e.user_id = auth.uid() and e.date between from_date and to_date
  group by e.date order by e.date;
$$;

/** Recently used items, so typing "co" offers "Coffee" with its usual category. */
create or replace function public.spend_recent_items(limit_n int default 40)
returns table (item text, category_id uuid, uses bigint, last_amount numeric)
language sql security definer stable set search_path = public as $$
  select e.item, e.category_id, count(*),
         (array_agg(e.amount order by e.date desc))[1]
  from public.spend_entries e
  where e.user_id = auth.uid() and e.item is not null and length(trim(e.item)) > 0
  group by e.item, e.category_id
  order by count(*) desc, max(e.date) desc
  limit least(greatest(coalesce(limit_n, 40), 1), 200);
$$;

-- 6. The Money pursuit ------------------------------------------------------------
-- It gets a pursuit so it shows up in the directory, on profiles, and in team
-- standings alongside everything else. Its page is bespoke, like Life and Lifts.

insert into public.pursuits (id, owner_id, name, description, kind, is_public) values
  ('33333333-3333-4333-8333-333333333305', null, 'Money',
   'What you spend, and what of it you actually needed. Categories are yours to bend.',
   'custom', true)
on conflict (id) do nothing;


-- ==========================================================================
-- 0035_challenges.sql
-- ==========================================================================
-- DayMax migration 35: Challenges — time-boxed competitions that outlive
-- themselves.
--
-- A challenge is NOT a pursuit. A pursuit is forever; a challenge has a start,
-- an end, a winner, and then becomes a record you can look back at. It can hang
-- off a pursuit (this one hangs off Money) but you can be invited into a
-- challenge without joining the pursuit — that's the point of the invite token.
--
-- PRIVACY, because this is money and getting it wrong matters:
--   * Joining is the consent. You are told what becomes visible before you join.
--   * The DEFAULT public number is a PERCENTAGE of your own income, not a dollar
--     amount. "Spent 12% of what came in" compares a student to a surgeon
--     fairly and reveals far less than "spent $4,300".
--   * Absolute amounts are opt-in per member (`share_amounts`). Off by default.
--   * Nothing is ever visible to non-members. Ever.

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  pursuit_id uuid references public.pursuits (id) on delete set null,
  owner_id uuid references auth.users (id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 80),
  description text not null default '',
  -- lower_nonessential: least non-essential spend wins
  -- lower_nonessential_pct: least, as a share of income, wins
  metric text not null default 'lower_nonessential_pct'
    check (metric in ('lower_nonessential', 'lower_nonessential_pct')),
  starts_on date not null,
  ends_on date not null,
  is_public boolean not null default true,
  invite_token uuid not null default gen_random_uuid(),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists challenges_dates_idx on public.challenges (starts_on, ends_on);
create unique index if not exists challenges_token_idx on public.challenges (invite_token);
alter table public.challenges enable row level security;

create table if not exists public.challenge_members (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  -- off by default: percentages are shared, dollars are not
  share_amounts boolean not null default false,
  primary key (challenge_id, user_id)
);
create index if not exists challenge_members_user_idx on public.challenge_members (user_id);
alter table public.challenge_members enable row level security;

-- Frozen final standings. Computed once when the challenge ends so the result
-- can never drift if someone edits old spending afterwards.
create table if not exists public.challenge_results (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rank int not null,
  score numeric,
  non_essential numeric,
  essential numeric,
  income numeric,
  entries int,
  primary key (challenge_id, user_id)
);
alter table public.challenge_results enable row level security;

create or replace function public.is_challenge_member(c uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.challenge_members m
                  where m.challenge_id = c and m.user_id = auth.uid());
$$;

drop policy if exists "see public or joined challenges" on public.challenges;
create policy "see public or joined challenges" on public.challenges
  for select using (is_public or owner_id = auth.uid() or public.is_challenge_member(id));
drop policy if exists "create own challenge" on public.challenges;
create policy "create own challenge" on public.challenges
  for insert with check (owner_id = auth.uid());
drop policy if exists "owner edits challenge" on public.challenges;
create policy "owner edits challenge" on public.challenges
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "owner deletes challenge" on public.challenges;
create policy "owner deletes challenge" on public.challenges
  for delete using (owner_id = auth.uid());

drop policy if exists "members see each other" on public.challenge_members;
create policy "members see each other" on public.challenge_members
  for select using (public.is_challenge_member(challenge_id) or user_id = auth.uid());
drop policy if exists "join or leave yourself" on public.challenge_members;
create policy "join or leave yourself" on public.challenge_members
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "members see results" on public.challenge_results;
create policy "members see results" on public.challenge_results
  for select using (public.is_challenge_member(challenge_id) or user_id = auth.uid());

-- 2. Live standings -------------------------------------------------------------

/**
 * Where everyone stands right now. Members only.
 *
 * Amounts come back NULL for anyone who hasn't opted into sharing them —
 * their percentage still ranks them, so the competition works without anyone
 * being forced to publish their bank balance.
 */
create or replace function public.challenge_standings(c uuid)
returns table (
  user_id uuid, display_name text, username text, team text,
  score numeric, non_essential numeric, essential numeric,
  income numeric, pct numeric, entries bigint, shares_amounts boolean, is_me boolean
)
language plpgsql security definer stable set search_path = public as $$
declare
  ch public.challenges%rowtype;
begin
  select * into ch from public.challenges where id = c;
  if ch.id is null then raise exception 'No such challenge'; end if;
  if not public.is_challenge_member(c) and ch.owner_id is distinct from auth.uid() then
    raise exception 'Join this challenge to see the standings';
  end if;

  return query
  with per_person as (
    select m.user_id as uid,
           m.share_amounts,
           coalesce(sum(e.amount) filter (where not coalesce(cp.essential, sc.essential, false)), 0) as ne,
           coalesce(sum(e.amount) filter (where     coalesce(cp.essential, sc.essential, false)), 0) as es,
           count(e.*) as n
    from public.challenge_members m
    left join public.spend_entries e
      on e.user_id = m.user_id and e.date between ch.starts_on and ch.ends_on
    left join public.spend_categories sc on sc.id = e.category_id
    left join public.spend_category_prefs cp on cp.category_id = e.category_id and cp.user_id = m.user_id
    where m.challenge_id = c
    group by m.user_id, m.share_amounts
  ),
  with_income as (
    select pp.*,
           coalesce((select sum(i.amount) from public.income_entries i
                      where i.user_id = pp.uid and i.date between ch.starts_on and ch.ends_on), 0) as inc
    from per_person pp
  )
  select w.uid,
         coalesce(p.display_name, 'anonymous'),
         p.username,
         coalesce(p.theme, 'light'),
         case when ch.metric = 'lower_nonessential' then w.ne
              when w.inc > 0 then round(w.ne / w.inc * 100, 1)
              else null end,
         case when w.share_amounts or w.uid = auth.uid() then w.ne else null end,
         case when w.share_amounts or w.uid = auth.uid() then w.es else null end,
         case when w.share_amounts or w.uid = auth.uid() then w.inc else null end,
         case when w.inc > 0 then round(w.ne / w.inc * 100, 1) else null end,
         w.n,
         w.share_amounts,
         w.uid = auth.uid()
  from with_income w
  left join public.profiles p on p.id = w.uid
  -- nulls last: someone with no income recorded can't be ranked on a percentage
  order by 5 asc nulls last;
end $$;

/** Freeze the result. Idempotent, and only after the end date. */
create or replace function public.finalize_challenge(c uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ch public.challenges%rowtype;
begin
  select * into ch from public.challenges where id = c;
  if ch.id is null then raise exception 'No such challenge'; end if;
  if ch.finalized_at is not null then return; end if;
  if current_date <= ch.ends_on then raise exception 'Challenge has not finished yet'; end if;

  insert into public.challenge_results (challenge_id, user_id, rank, score, non_essential, essential, income, entries)
  select c, s.user_id,
         row_number() over (order by s.score asc nulls last),
         s.score, s.non_essential, s.essential, s.income, s.entries
  from public.challenge_standings(c) s
  on conflict (challenge_id, user_id) do nothing;

  update public.challenges set finalized_at = now() where id = c;
end $$;

/** Join by invite token — works whether or not you're in the pursuit. */
create or replace function public.join_challenge(token uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare ch public.challenges%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into ch from public.challenges where invite_token = token;
  if ch.id is null then raise exception 'That invite link is not valid'; end if;
  if current_date > ch.ends_on then raise exception 'That challenge has already finished'; end if;

  insert into public.challenge_members (challenge_id, user_id)
  values (ch.id, auth.uid()) on conflict do nothing;

  -- Joining a money challenge puts you in the Money pursuit too, otherwise you
  -- have nowhere to log the spending the challenge is measuring.
  if ch.pursuit_id is not null then
    insert into public.pursuit_members (pursuit_id, user_id, role)
    values (ch.pursuit_id, auth.uid(), 'member') on conflict do nothing;
  end if;
  return ch.id;
end $$;

/** Challenges I'm in or could join, with live counts. */
create or replace function public.my_challenges()
returns table (
  id uuid, name text, description text, metric text,
  starts_on date, ends_on date, members bigint, is_member boolean,
  is_owner boolean, finalized boolean, days_left int, invite_token uuid
)
language sql security definer stable set search_path = public as $$
  select c.id, c.name, c.description, c.metric, c.starts_on, c.ends_on,
         (select count(*) from public.challenge_members m where m.challenge_id = c.id),
         public.is_challenge_member(c.id),
         c.owner_id = auth.uid(),
         c.finalized_at is not null,
         greatest(0, (c.ends_on - current_date))::int,
         case when c.owner_id = auth.uid() then c.invite_token else null end
  from public.challenges c
  where c.is_public or c.owner_id = auth.uid() or public.is_challenge_member(c.id)
  order by (c.ends_on < current_date), c.ends_on;
$$;

-- 3. The first challenge -----------------------------------------------------------
-- 15 Sept -> 15 Oct 2026. Ownerless, like the built-in pursuits, so anybody can
-- join and it doesn't disappear if one account is deleted.

insert into public.challenges (id, pursuit_id, owner_id, name, description, metric, starts_on, ends_on, is_public)
values (
  '66666666-0000-4000-8000-000000000001',
  '33333333-3333-4333-8333-333333333305',
  null,
  '30 Days, Less Spent',
  'Who can spend the least on non-essentials between 15 September and 15 October? Ranked by share of your own income, so it is a fair fight regardless of what you earn. Essentials — rent, groceries, bills, transport — do not count against you.',
  'lower_nonessential_pct',
  '2026-09-15',
  '2026-10-15',
  true
) on conflict (id) do nothing;


commit;

-- ============================================================================
-- VERIFY (run separately)
-- ============================================================================
-- select count(*) as builtin_categories from public.spend_categories where user_id is null;   -- expect 25
-- select name, starts_on, ends_on from public.challenges;                                     -- expect the 30-day one
-- select * from public.my_spend_categories() limit 5;
