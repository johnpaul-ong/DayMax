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
