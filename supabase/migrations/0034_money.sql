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

-- 7. Currency ---------------------------------------------------------------------
-- Money is meaningless without it, and a challenge that silently ranks dollars
-- against euros is actively wrong. Defaults to AUD because that's where this
-- was built; every user can change it.
alter table public.profiles add column if not exists currency text not null default 'AUD';
