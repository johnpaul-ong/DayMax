-- DayMax migration 36: Budget Baddies.
--
--   * Rename the challenge and switch it to ranking on DOLLARS, not percent.
--     Percent is the fairer comparison in the abstract, but "who spent least"
--     is what people actually argue about, and the percentage is still shown
--     everywhere on the page. Rank on the number people care about; inform
--     with the rest.
--   * Income becomes a baseline you can set, defaulting to your last income
--     entry BEFORE the challenge started — most people are paid monthly, so
--     "income earned during these 30 days" was the wrong denominator.
--   * Invite friends from inside the app, not just by link.

update public.challenges
   set name = 'Budget Baddies',
       description = 'Who can spend the least on non-essentials between 15 September and 15 October? '
                     || 'Ranked on the raw number — essentials like rent, groceries and bills do not count '
                     || 'against you. Percentages, categories and daily trends are all on the board too.',
       metric = 'lower_nonessential'
 where id = '66666666-0000-4000-8000-000000000001';

-- A baseline you can nudge. Null = work it out for me.
alter table public.challenge_members add column if not exists income_override numeric(12, 2);

/**
 * The income figure to judge someone against.
 *   1. their explicit override, if set
 *   2. otherwise their most recent income entry ON OR BEFORE the start date
 *      (a monthly salary paid on the 1st is the right denominator for a
 *      challenge starting on the 15th)
 *   3. otherwise whatever came in during the window
 */
create or replace function public.challenge_income(c uuid, u uuid)
returns numeric language sql security definer stable set search_path = public as $$
  with ch as (select starts_on, ends_on from public.challenges where id = c)
  select coalesce(
    (select m.income_override from public.challenge_members m
      where m.challenge_id = c and m.user_id = u),
    (select i.amount from public.income_entries i, ch
      where i.user_id = u and i.date <= ch.starts_on
      order by i.date desc limit 1),
    (select sum(i.amount) from public.income_entries i, ch
      where i.user_id = u and i.date between ch.starts_on and ch.ends_on),
    0
  );
$$;

-- Standings: rank on the metric, but return everything the page needs to be
-- interesting — dollars, percent, essentials, daily pace, biggest category.
drop function if exists public.challenge_standings(uuid);
create function public.challenge_standings(c uuid)
returns table (
  user_id uuid, display_name text, username text, team text,
  score numeric, non_essential numeric, essential numeric, total numeric,
  income numeric, pct numeric, entries bigint, per_day numeric,
  top_category text, top_category_amount numeric,
  shares_amounts boolean, is_me boolean
)
language plpgsql security definer stable set search_path = public as $$
declare
  ch public.challenges%rowtype;
  days int;
begin
  select * into ch from public.challenges where id = c;
  if ch.id is null then raise exception 'No such challenge'; end if;
  if not public.is_challenge_member(c) and ch.owner_id is distinct from auth.uid() then
    raise exception 'Join this challenge to see the standings';
  end if;
  days := greatest(1, least(current_date, ch.ends_on) - ch.starts_on + 1);

  return query
  with per_person as (
    select m.user_id as uid, m.share_amounts,
           coalesce(sum(e.amount) filter (where not coalesce(cp.essential, sc.essential, false)), 0) as ne,
           coalesce(sum(e.amount) filter (where     coalesce(cp.essential, sc.essential, false)), 0) as es,
           coalesce(sum(e.amount), 0) as tot,
           count(e.*) as n
    from public.challenge_members m
    left join public.spend_entries e
      on e.user_id = m.user_id and e.date between ch.starts_on and ch.ends_on
    left join public.spend_categories sc on sc.id = e.category_id
    left join public.spend_category_prefs cp on cp.category_id = e.category_id and cp.user_id = m.user_id
    where m.challenge_id = c
    group by m.user_id, m.share_amounts
  ),
  topcat as (
    select distinct on (e.user_id) e.user_id,
           coalesce(sc.name, 'Uncategorised') as cname,
           sum(e.amount) as camount
    from public.spend_entries e
    join public.challenge_members m on m.challenge_id = c and m.user_id = e.user_id
    left join public.spend_categories sc on sc.id = e.category_id
    left join public.spend_category_prefs cp on cp.category_id = e.category_id and cp.user_id = e.user_id
    where e.date between ch.starts_on and ch.ends_on
      and not coalesce(cp.essential, sc.essential, false)
    group by e.user_id, sc.name
    order by e.user_id, sum(e.amount) desc
  )
  select pp.uid,
         coalesce(p.display_name, 'anonymous'),
         p.username,
         coalesce(p.theme, 'light'),
         case when ch.metric = 'lower_nonessential' then pp.ne
              when public.challenge_income(c, pp.uid) > 0
                then round(pp.ne / public.challenge_income(c, pp.uid) * 100, 1)
              else null end,
         case when pp.share_amounts or pp.uid = auth.uid() then pp.ne else null end,
         case when pp.share_amounts or pp.uid = auth.uid() then pp.es else null end,
         case when pp.share_amounts or pp.uid = auth.uid() then pp.tot else null end,
         case when pp.share_amounts or pp.uid = auth.uid() then public.challenge_income(c, pp.uid) else null end,
         case when public.challenge_income(c, pp.uid) > 0
              then round(pp.ne / public.challenge_income(c, pp.uid) * 100, 1) else null end,
         pp.n,
         round(pp.ne / days, 2),
         tc.cname,
         case when pp.share_amounts or pp.uid = auth.uid() then tc.camount else null end,
         pp.share_amounts,
         pp.uid = auth.uid()
  from per_person pp
  left join public.profiles p on p.id = pp.uid
  left join topcat tc on tc.user_id = pp.uid
  order by 5 asc nulls last;
end $$;

/** Daily cumulative non-essential spend per member — the race chart. */
create or replace function public.challenge_daily(c uuid)
returns table (date date, user_id uuid, display_name text, spent numeric, running numeric)
language plpgsql security definer stable set search_path = public as $$
declare ch public.challenges%rowtype;
begin
  select * into ch from public.challenges where id = c;
  if not public.is_challenge_member(c) and ch.owner_id is distinct from auth.uid() then
    raise exception 'Join this challenge to see the standings';
  end if;
  return query
  with days as (
    select generate_series(ch.starts_on, least(current_date, ch.ends_on), '1 day')::date as d
  ),
  mem as (select m.user_id from public.challenge_members m where m.challenge_id = c),
  daily as (
    select d.d, mm.user_id,
           coalesce(sum(e.amount) filter (where not coalesce(cp.essential, sc.essential, false)), 0) as amt
    from days d
    cross join mem mm
    left join public.spend_entries e on e.user_id = mm.user_id and e.date = d.d
    left join public.spend_categories sc on sc.id = e.category_id
    left join public.spend_category_prefs cp on cp.category_id = e.category_id and cp.user_id = mm.user_id
    group by d.d, mm.user_id
  )
  select dd.d, dd.user_id, coalesce(p.display_name, 'anonymous'), dd.amt,
         sum(dd.amt) over (partition by dd.user_id order by dd.d)
  from daily dd
  left join public.profiles p on p.id = dd.user_id
  order by dd.d;
end $$;

/** What the group as a whole is spending on. Aggregate, so it leaks nobody. */
create or replace function public.challenge_categories(c uuid)
returns table (name text, essential boolean, total numeric, people bigint)
language plpgsql security definer stable set search_path = public as $$
declare ch public.challenges%rowtype;
begin
  select * into ch from public.challenges where id = c;
  if not public.is_challenge_member(c) and ch.owner_id is distinct from auth.uid() then
    raise exception 'Join this challenge to see the standings';
  end if;
  return query
  select coalesce(sc.name, 'Uncategorised'),
         coalesce(cp.essential, sc.essential, false),
         sum(e.amount), count(distinct e.user_id)
  from public.spend_entries e
  join public.challenge_members m on m.challenge_id = c and m.user_id = e.user_id
  left join public.spend_categories sc on sc.id = e.category_id
  left join public.spend_category_prefs cp on cp.category_id = e.category_id and cp.user_id = e.user_id
  where e.date between ch.starts_on and ch.ends_on
  group by 1, 2 order by 3 desc;
end $$;

-- Invitations: ask a friend, don't conscript them ------------------------------
create table if not exists public.challenge_invites (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  invited_user uuid not null references auth.users (id) on delete cascade,
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (challenge_id, invited_user)
);
alter table public.challenge_invites enable row level security;

drop policy if exists "see invites to or from me" on public.challenge_invites;
create policy "see invites to or from me" on public.challenge_invites
  for select using (invited_user = auth.uid() or invited_by = auth.uid());
drop policy if exists "members invite friends" on public.challenge_invites;
create policy "members invite friends" on public.challenge_invites
  for insert with check (
    invited_by = auth.uid()
    and public.is_challenge_member(challenge_id)
    and public.are_friends(auth.uid(), invited_user)   -- friends only, no cold invites
  );
drop policy if exists "dismiss or withdraw" on public.challenge_invites;
create policy "dismiss or withdraw" on public.challenge_invites
  for delete using (invited_user = auth.uid() or invited_by = auth.uid());

/** Invitations waiting for me. */
create or replace function public.my_challenge_invites()
returns table (challenge_id uuid, name text, starts_on date, ends_on date, invited_by_name text)
language sql security definer stable set search_path = public as $$
  select i.challenge_id, c.name, c.starts_on, c.ends_on, coalesce(p.display_name, 'someone')
  from public.challenge_invites i
  join public.challenges c on c.id = i.challenge_id
  left join public.profiles p on p.id = i.invited_by
  where i.invited_user = auth.uid()
    and not public.is_challenge_member(i.challenge_id)
    and c.ends_on >= current_date;
$$;

/** Friends I could still invite to this challenge. */
create or replace function public.challenge_invitable_friends(c uuid)
returns table (member_id uuid, display_name text, username text, invited boolean)
language sql security definer stable set search_path = public as $$
  select f.id, coalesce(f.display_name, 'anonymous'), f.username,
         exists (select 1 from public.challenge_invites i
                  where i.challenge_id = c and i.invited_user = f.id)
  from public.profiles f
  where public.are_friends(auth.uid(), f.id)
    and not exists (select 1 from public.challenge_members m
                     where m.challenge_id = c and m.user_id = f.id)
  order by 2;
$$;
