-- DayMax migration 38: challenges stop being about money.
--
-- A challenge was "least non-essential spend, in dollars or as a percentage",
-- and nothing else. The metric column had exactly two legal values, both of
-- them money, and the winning direction was baked into the *name* of the
-- metric ("lower_nonessential") so there was no way to say "most".
--
-- A challenge is really one sentence:
--
--     over THIS WINDOW, rank members by THIS NUMBER, where MORE or LESS wins.
--
-- So the row now carries three independent things instead of one:
--
--   metric     what number to compute      (money / life / a pursuit stat)
--   direction  which end of it wins        ('more' | 'less'; null = the
--                                           natural default for that metric)
--   stat_id    which pursuit stat, when the metric is 'pursuit_stat'
--
-- NOTHING EXISTING CHANGES. 'lower_nonessential' and 'lower_nonessential_pct'
-- stay legal values and stay on the rows that have them; they are normalised
-- to their new names in one place (challenge_metric) and their direction
-- defaults to 'less'. Budget Baddies
-- (66666666-0000-4000-8000-000000000001) computes and orders exactly as it
-- did: same window, same essential/non-essential split, same income baseline,
-- same ascending sort.
--
-- SECURITY, because this migration adds two foreign keys to the table and
-- 0030 is a list of four bugs that were all the same mistake: an UPDATE policy
-- that pins the owner but not the parent, letting a row be re-parented past
-- the INSERT policy that was doing the real access control. Both new FKs
-- (pursuit_id, which was never pinned either, and stat_id) are now checked in
-- the INSERT *and* UPDATE policies, and challenge_members gets the same
-- freeze trigger that pursuit_members and track_members got in 0030.

-- ---------------------------------------------------------------------------
-- 1. Columns and constraints
-- ---------------------------------------------------------------------------

alter table public.challenges add column if not exists direction text;
alter table public.challenges add column if not exists stat_id uuid;

-- The FK, like challenges_pursuit_fk in 0035, only if the table is there.
do $$
begin
  if to_regclass('public.pursuit_stats') is not null
     and not exists (select 1 from pg_constraint where conname = 'challenges_stat_fk') then
    alter table public.challenges
      add constraint challenges_stat_fk
      foreign key (stat_id) references public.pursuit_stats (id) on delete set null;
  end if;
end $$;
create index if not exists challenges_stat_idx on public.challenges (stat_id);

-- The metric CHECK was written inline in 0035, so its name is whatever
-- Postgres generated. Find it by its contents rather than guessing.
do $$
declare cname text;
begin
  for cname in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'challenges'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%lower_nonessential%'
  loop
    execute format('alter table public.challenges drop constraint %I', cname);
  end loop;
end $$;

alter table public.challenges drop constraint if exists challenges_metric_allowed;
alter table public.challenges add constraint challenges_metric_allowed
  check (metric in (
    -- legacy spellings, still in the table, still ranked identically
    'lower_nonessential', 'lower_nonessential_pct',
    -- money
    'money_nonessential', 'money_nonessential_pct', 'money_total',
    -- life (the 15-minute grid)
    'life_productive_hours', 'life_workmax', 'life_focus',
    'life_brainrot_hours', 'life_sleep_hours', 'life_streak',
    -- anything a pursuit measures
    'pursuit_stat'
  ));

alter table public.challenges drop constraint if exists challenges_direction_check;
alter table public.challenges add constraint challenges_direction_check
  check (direction is null or direction in ('more', 'less'));

-- A 'pursuit_stat' challenge with no stat can never produce a board, so the
-- database refuses to store one. An empty leaderboard is worse than no option.
alter table public.challenges drop constraint if exists challenges_stat_required;
alter table public.challenges add constraint challenges_stat_required
  check (metric <> 'pursuit_stat' or stat_id is not null);

-- ---------------------------------------------------------------------------
-- 2. The metric vocabulary, in SQL, so the server and the client agree
-- ---------------------------------------------------------------------------

/** Legacy metric names -> canonical ones. The only place that mapping lives. */
create or replace function public.challenge_metric(m text)
returns text language sql immutable as $$
  select case
    when m = 'lower_nonessential'     then 'money_nonessential'
    when m = 'lower_nonessential_pct' then 'money_nonessential_pct'
    else coalesce(m, 'money_nonessential')
  end;
$$;

/** money | life | stat — which tables the score comes out of. */
create or replace function public.challenge_metric_family(m text)
returns text language sql immutable as $$
  select case public.challenge_metric(m)
    when 'money_nonessential'     then 'money'
    when 'money_nonessential_pct' then 'money'
    when 'money_total'            then 'money'
    when 'pursuit_stat'           then 'stat'
    else 'life'
  end;
$$;

/**
 * Which end wins when the challenge doesn't say.
 * A pursuit stat already knows its own direction ('more'/'less' on
 * pursuit_stats), so it inherits it — that is why challenges.direction is
 * nullable rather than defaulted: null means "the natural direction".
 */
create or replace function public.challenge_default_direction(m text, stat_dir text default null)
returns text language sql immutable as $$
  select case public.challenge_metric(m)
    when 'money_nonessential'     then 'less'
    when 'money_nonessential_pct' then 'less'
    when 'money_total'            then 'less'
    when 'life_brainrot_hours'    then 'less'
    when 'pursuit_stat'           then coalesce(stat_dir, 'more')
    else 'more'
  end;
$$;

/**
 * What the score is measured in. 'currency' is a sentinel — the client formats
 * it with the viewer's own currency symbol, because the number is dollars (or
 * pounds, or yen) and a hardcoded '$' on a GBP account is a lie.
 */
create or replace function public.challenge_metric_unit(m text, stat_unit text default null)
returns text language sql immutable as $$
  select case public.challenge_metric(m)
    when 'money_nonessential'     then 'currency'
    when 'money_total'            then 'currency'
    when 'money_nonessential_pct' then '%'
    when 'life_productive_hours'  then 'h'
    when 'life_brainrot_hours'    then 'h'
    when 'life_sleep_hours'       then 'h'
    when 'life_workmax'           then 'h'
    when 'life_focus'             then 'pts'
    when 'life_streak'            then 'days'
    else coalesce(nullif(trim(stat_unit), ''), '')
  end;
$$;

/** One line of English: "Most productive hours", "Least total spending". */
create or replace function public.challenge_metric_label(m text, dir text, stat_name text default null)
returns text language sql immutable as $$
  select case
    when public.challenge_metric(m) = 'life_streak'
      then case when dir = 'less' then 'Shortest logging streak' else 'Longest logging streak' end
    else (case when dir = 'less' then 'Least ' else 'Most ' end) ||
      case public.challenge_metric(m)
        when 'money_nonessential'     then 'non-essential spending'
        when 'money_nonessential_pct' then 'non-essential spending, as a share of income'
        when 'money_total'            then 'total spending'
        when 'life_productive_hours'  then 'productive hours'
        when 'life_brainrot_hours'    then 'brainrot hours'
        when 'life_sleep_hours'       then 'sleep'
        when 'life_focus'             then 'focus score'
        when 'life_workmax'           then 'WorkMax'
        else coalesce(nullif(trim(stat_name), ''), 'a pursuit stat')
      end
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. RLS: pin the parents, not just the owner
-- ---------------------------------------------------------------------------

/** A challenge may only hang off a pursuit its owner can actually see. */
create or replace function public.challenge_pursuit_allowed(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p is null or public.can_see_pursuit(p);
$$;

/**
 * A challenge may only rank on a stat whose pursuit you are a MEMBER of
 * (not merely "can see"): membership is what lets you read the stat's values
 * through pursuit_stat_data, so it is the right bar for building a
 * leaderboard out of them. It also stops stat ids being probed for existence.
 */
create or replace function public.challenge_stat_allowed(s uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select s is null or exists (
    select 1 from public.pursuit_stats ps
    join public.pursuit_members pm on pm.pursuit_id = ps.pursuit_id and pm.user_id = auth.uid()
    where ps.id = s
  );
$$;

drop policy if exists "create own challenge" on public.challenges;
create policy "create own challenge" on public.challenges
  for insert with check (
    owner_id = auth.uid()
    and public.challenge_pursuit_allowed(pursuit_id)
    and public.challenge_stat_allowed(stat_id)
  );

-- THE 0030 MISTAKE, not repeated: WITH CHECK pins the owner AND both foreign
-- keys. Without the FKs here, an owner could create a legitimate challenge,
-- collect members, and then re-point stat_id at a stat they cannot read or
-- pursuit_id at a pursuit they are not in.
drop policy if exists "owner edits challenge" on public.challenges;
create policy "owner edits challenge" on public.challenges
  for update
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and public.challenge_pursuit_allowed(pursuit_id)
    and public.challenge_stat_allowed(stat_id)
  );

-- challenge_members had the same hole pursuit_members had before 0030: the
-- policy is `user_id = auth.uid()` for ALL, so an UPDATE could move your own
-- membership row onto a private challenge and hand you its standings. A
-- policy cannot see the OLD row, so freeze it in a trigger, exactly as 0030
-- does for pursuits, tracks and posts.
create or replace function public.freeze_challenge_membership()
returns trigger language plpgsql as $$
begin
  if new.challenge_id <> old.challenge_id or new.user_id <> old.user_id then
    raise exception 'Cannot move a membership to another challenge';
  end if;
  return new;
end $$;
drop trigger if exists freeze_challenge_membership on public.challenge_members;
create trigger freeze_challenge_membership before update on public.challenge_members
  for each row execute function public.freeze_challenge_membership();

-- join_challenge is SECURITY DEFINER and inserts the joiner into the
-- challenge's pursuit, which bypasses pursuit_members' own INSERT policy
-- ("public or built-in only"). Re-apply that rule here, or a challenge
-- pointed at a private pursuit becomes a side door into it.
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

  -- Joining a challenge puts you in the pursuit it measures, so you have
  -- somewhere to log — but only when that pursuit is open to anyone anyway.
  if ch.pursuit_id is not null and to_regclass('public.pursuit_members') is not null
     and exists (select 1 from public.pursuits pu
                  where pu.id = ch.pursuit_id and (pu.is_public or pu.owner_id is null)) then
    insert into public.pursuit_members (pursuit_id, user_id, role)
    values (ch.pursuit_id, auth.uid(), 'member') on conflict do nothing;
  end if;
  return ch.id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Standings
-- ---------------------------------------------------------------------------

/**
 * Where everyone stands right now. Members only.
 *
 * One function, every metric. The shape of the answer never changes:
 *   score        the number being ranked, in the metric's own unit
 *   score_unit   'currency' | '%' | 'h' | 'pts' | 'days' | a stat's own unit
 *   score_label  "Most productive hours"
 *   rank_less    true when the SMALLEST score wins
 * and the rows come back already in rank order, leader first, whichever way
 * that is — so no caller ever has to know which direction this challenge runs.
 *
 * The money columns (non_essential / essential / total / income / pct /
 * top_category) are populated for money challenges and NULL for everything
 * else. That is deliberate: joining a sleep challenge must not publish your
 * spending, so the spend tables are not even read.
 *
 * Money rules are untouched from 0036: whole window (not clamped to today),
 * essential split from the member's own category prefs, income from
 * challenge_income(), amounts hidden unless share_amounts.
 *
 * Life rules:
 *   * The bucket map is the CHALLENGE OWNER's (falling back to the DayMax
 *     defaults: productive = Work + Sports, brainrot = Other + Leisure).
 *     One rulebook for everyone — with each member's own settings I could
 *     file TikTok as 'productive' and win. This mirrors compare_day_totals.
 *   * The window is clamped to today, so pre-generated demo days and anyone
 *     logging into the future cannot count time that has not happened.
 *   * A member who logged nothing scores NULL, not 0. On a "least brainrot"
 *     board, zero-because-you-never-logged would otherwise beat everyone.
 */
drop function if exists public.challenge_standings(uuid);
create function public.challenge_standings(c uuid)
returns table (
  user_id uuid, display_name text, username text, team text,
  score numeric, non_essential numeric, essential numeric, total numeric,
  income numeric, pct numeric, entries bigint, per_day numeric,
  top_category text, top_category_amount numeric,
  shares_amounts boolean, is_me boolean,
  score_unit text, score_label text, rank_less boolean
)
language plpgsql security definer stable set search_path = public as $$
declare
  ch public.challenges%rowtype;
  met text;
  fam text;
  less_wins boolean;
  ndays int;
  win_end date;
  st_name text;
  st_unit text;
  st_dir text;
  st_cad text;
  unit_txt text;
  label_txt text;
begin
  select * into ch from public.challenges where id = c;
  if ch.id is null then raise exception 'No such challenge'; end if;
  if not public.is_challenge_member(c) and ch.owner_id is distinct from auth.uid() then
    raise exception 'Join this challenge to see the standings';
  end if;

  met := public.challenge_metric(ch.metric);
  fam := public.challenge_metric_family(ch.metric);
  select ps.name, ps.unit, ps.direction, ps.cadence
    into st_name, st_unit, st_dir, st_cad
    from public.pursuit_stats ps where ps.id = ch.stat_id;
  less_wins := coalesce(ch.direction, public.challenge_default_direction(ch.metric, st_dir)) = 'less';
  unit_txt  := public.challenge_metric_unit(ch.metric, st_unit);
  label_txt := public.challenge_metric_label(ch.metric,
                 case when less_wins then 'less' else 'more' end, st_name);
  ndays   := greatest(1, least(current_date, ch.ends_on) - ch.starts_on + 1);
  win_end := least(current_date, ch.ends_on);

  return query
  with rules as (
    -- category -> bucket, the challenge owner's map, defaults where unset
    select g.category,
           coalesce(bs.bucket,
             case when g.category in (1, 2) then 'productive'
                  when g.category in (6, 9) then 'brainrot'
                  else 'other' end) as bucket
    from (select generate_series(0, 9) as category) g
    left join public.bucket_settings bs
      on bs.category = g.category and bs.user_id = ch.owner_id
  ),
  mem as (
    select mb.user_id as uid, mb.share_amounts
    from public.challenge_members mb
    where mb.challenge_id = c
  ),
  -- Each family is gated on `fam` so a life challenge never touches the spend
  -- tables and vice versa: it is one-time-filtered away by the planner.
  spend as (
    select mm.uid,
           coalesce(sum(e.amount) filter (where not coalesce(cp.essential, sc.essential, false)), 0) as ne,
           coalesce(sum(e.amount) filter (where     coalesce(cp.essential, sc.essential, false)), 0) as es,
           coalesce(sum(e.amount), 0) as tot,
           count(e.*) as n
    from mem mm
    left join public.spend_entries e
      on e.user_id = mm.uid and e.date between ch.starts_on and ch.ends_on
    left join public.spend_categories sc on sc.id = e.category_id
    left join public.spend_category_prefs cp on cp.category_id = e.category_id and cp.user_id = mm.uid
    where fam = 'money'
    group by mm.uid
  ),
  topcat as (
    select distinct on (e.user_id) e.user_id,
           coalesce(sc.name, 'Uncategorised') as cname,
           sum(e.amount) as camount
    from public.spend_entries e
    join public.challenge_members mb on mb.challenge_id = c and mb.user_id = e.user_id
    left join public.spend_categories sc on sc.id = e.category_id
    left join public.spend_category_prefs cp on cp.category_id = e.category_id and cp.user_id = e.user_id
    where e.date between ch.starts_on and ch.ends_on
      and not coalesce(cp.essential, sc.essential, false)
      and fam = 'money'
    group by e.user_id, sc.name
    order by e.user_id, sum(e.amount) desc
  ),
  life as (
    select mm.uid,
           sum(case when r.bucket = 'productive' then 0.25 else 0 end) as ph,
           sum(case when r.bucket = 'brainrot'   then 0.25 else 0 end) as bh,
           sum(case when e.category = 0          then 0.25 else 0 end) as sh,
           count(distinct e.date) as dlogged
    from mem mm
    left join public.day_entries e
      on e.user_id = mm.uid and e.date between ch.starts_on and win_end
    left join rules r on r.category = e.category
    where fam = 'life'
    group by mm.uid
  ),
  -- longest run of consecutive logged days: gaps and islands, the date minus
  -- its row number is constant within a run
  streak as (
    select isl.uid, max(isl.runlen) as best
    from (
      select grp.uid, grp.g, count(*) as runlen
      from (
        select e.user_id as uid,
               e.date - (row_number() over (partition by e.user_id order by e.date))::int as g
        from public.day_entries e
        join mem mm on mm.uid = e.user_id
        where e.date between ch.starts_on and win_end
          and met = 'life_streak'
        group by e.user_id, e.date
      ) grp
      group by grp.uid, grp.g
    ) isl
    group by isl.uid
  ),
  stat as (
    select mm.uid,
           sum(pe.value) as s_sum,
           max(pe.value) as s_max,
           min(pe.value) as s_min,
           count(pe.*) as n
    from mem mm
    left join public.pursuit_entries pe
      on pe.user_id = mm.uid and pe.stat_id = ch.stat_id
         and pe.date between ch.starts_on and win_end
    where fam = 'stat'
    group by mm.uid
  ),
  gathered as (
    select mm.uid, mm.share_amounts,
           sp.ne, sp.es, sp.tot, sp.n as spend_n,
           lf.ph, lf.bh, lf.sh, lf.dlogged,
           sr.s_sum, sr.s_max, sr.s_min, sr.n as stat_n,
           coalesce(sk.best, 0) as best_run,
           case when fam = 'money' then public.challenge_income(c, mm.uid) end as inc
    from mem mm
    left join spend  sp on sp.uid = mm.uid
    left join life   lf on lf.uid = mm.uid
    left join stat   sr on sr.uid = mm.uid
    left join streak sk on sk.uid = mm.uid
  ),
  scored as (
    select gt.*,
      case met
        when 'money_nonessential'     then gt.ne
        when 'money_total'            then gt.tot
        when 'money_nonessential_pct' then case when gt.inc > 0 then round(gt.ne / gt.inc * 100, 1) end
        when 'life_productive_hours'  then case when gt.dlogged > 0 then gt.ph end
        when 'life_brainrot_hours'    then case when gt.dlogged > 0 then gt.bh end
        when 'life_sleep_hours'       then case when gt.dlogged > 0 then gt.sh end
        when 'life_focus'             then case when gt.ph + gt.bh > 0
                                                then round(gt.ph / (gt.ph + gt.bh) * 100, 1) end
        when 'life_workmax'           then case when gt.ph + gt.bh > 0
                                                then round(gt.ph / (gt.ph + gt.bh) * gt.ph, 1) end
        when 'life_streak'            then case when gt.dlogged > 0 then gt.best_run::numeric end
        when 'pursuit_stat'           then case when coalesce(gt.stat_n, 0) > 0 then
                                                  case when st_cad = 'daily' then gt.s_sum
                                                       when less_wins then gt.s_min
                                                       else gt.s_max end
                                                end
      end as sc
    from gathered gt
  )
  select s.uid,
         coalesce(pr.display_name, 'anonymous'),
         pr.username,
         coalesce(pr.theme, 'light'),
         s.sc,
         case when fam = 'money' and (s.share_amounts or s.uid = auth.uid()) then s.ne end,
         case when fam = 'money' and (s.share_amounts or s.uid = auth.uid()) then s.es end,
         case when fam = 'money' and (s.share_amounts or s.uid = auth.uid()) then s.tot end,
         case when fam = 'money' and (s.share_amounts or s.uid = auth.uid()) then s.inc end,
         case when fam = 'money' and s.inc > 0 then round(s.ne / s.inc * 100, 1) end,
         coalesce(case when fam = 'money' then s.spend_n
                       when fam = 'life'  then s.dlogged
                       else s.stat_n end, 0),
         case when fam = 'money' then round(coalesce(s.ne, 0) / ndays, 2)
              when met in ('life_productive_hours', 'life_brainrot_hours',
                           'life_sleep_hours', 'life_workmax')
                then round(coalesce(s.sc, 0) / ndays, 2)
              when met = 'pursuit_stat' and st_cad = 'daily'
                then round(coalesce(s.sc, 0) / ndays, 2)
         end,
         case when fam = 'money' then tc.cname end,
         case when fam = 'money' and (s.share_amounts or s.uid = auth.uid()) then tc.camount end,
         s.share_amounts,
         s.uid = auth.uid(),
         unit_txt,
         label_txt,
         less_wins
  from scored s
  left join public.profiles pr on pr.id = s.uid
  left join topcat tc on tc.user_id = s.uid
  -- leader first either way. Negating instead of a second ORDER BY keeps
  -- "nulls last" meaning "no data ranks last" in both directions.
  order by (case when less_wins then s.sc else -s.sc end) asc nulls last, s.uid;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The race chart
-- ---------------------------------------------------------------------------

/**
 * Per member, per day: the day's own contribution and the running score.
 * "Running" means whatever running means for the metric — a cumulative sum
 * for totals, the score recomputed from cumulative inputs for WorkMax, focus
 * and percentages, the best-so-far for a whenever-cadence stat, and the
 * longest-run-so-far for a streak. The last point of each line is therefore
 * always that member's current standing.
 */
drop function if exists public.challenge_daily(uuid);
create function public.challenge_daily(c uuid)
returns table (date date, user_id uuid, display_name text, spent numeric, running numeric)
language plpgsql security definer stable set search_path = public as $$
declare
  ch public.challenges%rowtype;
  met text;
  fam text;
  less_wins boolean;
  win_end date;
  st_dir text;
  st_cad text;
begin
  select * into ch from public.challenges where id = c;
  if ch.id is null then raise exception 'No such challenge'; end if;
  if not public.is_challenge_member(c) and ch.owner_id is distinct from auth.uid() then
    raise exception 'Join this challenge to see the standings';
  end if;

  met := public.challenge_metric(ch.metric);
  fam := public.challenge_metric_family(ch.metric);
  select ps.direction, ps.cadence into st_dir, st_cad
    from public.pursuit_stats ps where ps.id = ch.stat_id;
  less_wins := coalesce(ch.direction, public.challenge_default_direction(ch.metric, st_dir)) = 'less';
  win_end := least(current_date, ch.ends_on);

  return query
  with dayspan as (
    select generate_series(ch.starts_on, win_end, '1 day')::date as d
  ),
  mem as (
    select mb.user_id as uid from public.challenge_members mb where mb.challenge_id = c
  ),
  rules as (
    select g.category,
           coalesce(bs.bucket,
             case when g.category in (1, 2) then 'productive'
                  when g.category in (6, 9) then 'brainrot'
                  else 'other' end) as bucket
    from (select generate_series(0, 9) as category) g
    left join public.bucket_settings bs
      on bs.category = g.category and bs.user_id = ch.owner_id
  ),
  msp as (
    select e.user_id as uid, e.date as d,
           coalesce(sum(e.amount) filter (where not coalesce(cp.essential, sc.essential, false)), 0) as ne,
           coalesce(sum(e.amount), 0) as tot
    from public.spend_entries e
    join mem mm on mm.uid = e.user_id
    left join public.spend_categories sc on sc.id = e.category_id
    left join public.spend_category_prefs cp on cp.category_id = e.category_id and cp.user_id = e.user_id
    where e.date between ch.starts_on and win_end and fam = 'money'
    group by e.user_id, e.date
  ),
  lday as (
    select e.user_id as uid, e.date as d,
           sum(case when r.bucket = 'productive' then 0.25 else 0 end) as ph,
           sum(case when r.bucket = 'brainrot'   then 0.25 else 0 end) as bh,
           sum(case when e.category = 0          then 0.25 else 0 end) as sh
    from public.day_entries e
    join mem mm on mm.uid = e.user_id
    join rules r on r.category = e.category
    where e.date between ch.starts_on and win_end and fam = 'life'
    group by e.user_id, e.date
  ),
  runlen as (
    select isl.uid, isl.d,
           row_number() over (partition by isl.uid, isl.g order by isl.d) as len
    from (
      select l.uid, l.d, l.d - (row_number() over (partition by l.uid order by l.d))::int as g
      from lday l
    ) isl
  ),
  sday as (
    select pe.user_id as uid, pe.date as d, sum(pe.value) as v
    from public.pursuit_entries pe
    join mem mm on mm.uid = pe.user_id
    where pe.stat_id = ch.stat_id and pe.date between ch.starts_on and win_end and fam = 'stat'
    group by pe.user_id, pe.date
  ),
  inc as (
    select mm.uid, case when fam = 'money' then public.challenge_income(c, mm.uid) else 0 end as v
    from mem mm
  ),
  base as (
    select dd.d, mm.uid,
           coalesce(ms.ne, 0) as ne, coalesce(ms.tot, 0) as tot,
           coalesce(lf.ph, 0) as ph, coalesce(lf.bh, 0) as bh, coalesce(lf.sh, 0) as sh,
           coalesce(rl.len, 0) as len,
           sd.v as sv,
           ic.v as income
    from dayspan dd
    cross join mem mm
    left join msp ms on ms.uid = mm.uid and ms.d = dd.d
    left join lday lf on lf.uid = mm.uid and lf.d = dd.d
    left join runlen rl on rl.uid = mm.uid and rl.d = dd.d
    left join sday sd on sd.uid = mm.uid and sd.d = dd.d
    left join inc ic on ic.uid = mm.uid
  ),
  calc as (
    select b.*,
           sum(b.ne)  over w as cne,
           sum(b.tot) over w as ctot,
           sum(b.ph)  over w as cph,
           sum(b.bh)  over w as cbh,
           sum(b.sh)  over w as csh,
           max(b.len) over w as cbest,
           sum(coalesce(b.sv, 0)) over w as csv,
           max(b.sv) over w as mxv,
           min(b.sv) over w as mnv
    from base b
    window w as (partition by b.uid order by b.d)
  )
  select k.d, k.uid, coalesce(pr.display_name, 'anonymous'),
    case met
      when 'money_nonessential'     then k.ne
      when 'money_nonessential_pct' then k.ne
      when 'money_total'            then k.tot
      when 'life_productive_hours'  then k.ph
      when 'life_brainrot_hours'    then k.bh
      when 'life_sleep_hours'       then k.sh
      when 'life_focus'             then case when k.ph + k.bh > 0
                                              then round(k.ph / (k.ph + k.bh) * 100, 1) else 0 end
      when 'life_workmax'           then case when k.ph + k.bh > 0
                                              then round(k.ph / (k.ph + k.bh) * k.ph, 1) else 0 end
      when 'life_streak'            then k.len::numeric
      when 'pursuit_stat'           then coalesce(k.sv, 0)
    end,
    case met
      when 'money_nonessential'     then k.cne
      when 'money_nonessential_pct' then case when k.income > 0 then round(k.cne / k.income * 100, 1) end
      when 'money_total'            then k.ctot
      when 'life_productive_hours'  then k.cph
      when 'life_brainrot_hours'    then k.cbh
      when 'life_sleep_hours'       then k.csh
      when 'life_focus'             then case when k.cph + k.cbh > 0
                                              then round(k.cph / (k.cph + k.cbh) * 100, 1) else 0 end
      when 'life_workmax'           then case when k.cph + k.cbh > 0
                                              then round(k.cph / (k.cph + k.cbh) * k.cph, 1) else 0 end
      when 'life_streak'            then k.cbest::numeric
      when 'pursuit_stat'           then case when st_cad = 'daily' then k.csv
                                              when less_wins then k.mnv
                                              else k.mxv end
    end
  from calc k
  left join public.profiles pr on pr.id = k.uid
  -- deterministic: the client pages this with .range()
  order by k.d, k.uid;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Category breakdown — money challenges only, now that there are others
-- ---------------------------------------------------------------------------

/**
 * What the group as a whole is spending on. Aggregate, so it leaks no
 * individual — and now it refuses to run at all on a non-money challenge.
 * Joining a sleep or chess challenge must not publish your spending.
 */
create or replace function public.challenge_categories(c uuid)
returns table (name text, essential boolean, total numeric, people bigint)
language plpgsql security definer stable set search_path = public as $$
declare ch public.challenges%rowtype;
begin
  select * into ch from public.challenges where id = c;
  if ch.id is null then raise exception 'No such challenge'; end if;
  if not public.is_challenge_member(c) and ch.owner_id is distinct from auth.uid() then
    raise exception 'Join this challenge to see the standings';
  end if;
  if public.challenge_metric_family(ch.metric) <> 'money' then return; end if;

  return query
  select coalesce(sc.name, 'Uncategorised'),
         coalesce(cp.essential, sc.essential, false),
         sum(e.amount), count(distinct e.user_id)
  from public.spend_entries e
  join public.challenge_members mb on mb.challenge_id = c and mb.user_id = e.user_id
  left join public.spend_categories sc on sc.id = e.category_id
  left join public.spend_category_prefs cp on cp.category_id = e.category_id and cp.user_id = e.user_id
  where e.date between ch.starts_on and ch.ends_on
  group by 1, 2 order by 3 desc;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Freezing the result, in the right direction
-- ---------------------------------------------------------------------------

create or replace function public.finalize_challenge(c uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  ch public.challenges%rowtype;
  st_dir text;
  less_wins boolean;
begin
  select * into ch from public.challenges where id = c;
  if ch.id is null then raise exception 'No such challenge'; end if;
  if ch.finalized_at is not null then return; end if;
  if current_date <= ch.ends_on then raise exception 'Challenge has not finished yet'; end if;

  select ps.direction into st_dir from public.pursuit_stats ps where ps.id = ch.stat_id;
  less_wins := coalesce(ch.direction, public.challenge_default_direction(ch.metric, st_dir)) = 'less';

  insert into public.challenge_results (challenge_id, user_id, rank, score, non_essential, essential, income, entries)
  select c, s.user_id,
         row_number() over (order by (case when less_wins then s.score else -s.score end) asc nulls last),
         s.score, s.non_essential, s.essential, s.income, s.entries
  from public.challenge_standings(c) s
  on conflict (challenge_id, user_id) do nothing;

  update public.challenges set finalized_at = now() where id = c;
end $$;

-- ---------------------------------------------------------------------------
-- 8. The list, which now has to say what each challenge measures
-- ---------------------------------------------------------------------------

drop function if exists public.my_challenges();
create function public.my_challenges()
returns table (
  id uuid, name text, description text, metric text,
  starts_on date, ends_on date, members bigint, is_member boolean,
  is_owner boolean, finalized boolean, days_left int, invite_token uuid,
  direction text, stat_id uuid, pursuit_id uuid, metric_label text, score_unit text
)
language sql security definer stable set search_path = public as $$
  select c.id, c.name, c.description, c.metric, c.starts_on, c.ends_on,
         (select count(*) from public.challenge_members mb where mb.challenge_id = c.id),
         public.is_challenge_member(c.id),
         c.owner_id = auth.uid(),
         c.finalized_at is not null,
         greatest(0, (c.ends_on - current_date))::int,
         case when c.owner_id = auth.uid() then c.invite_token else null end,
         coalesce(c.direction, public.challenge_default_direction(c.metric, ps.direction)),
         c.stat_id,
         c.pursuit_id,
         public.challenge_metric_label(
           c.metric,
           coalesce(c.direction, public.challenge_default_direction(c.metric, ps.direction)),
           ps.name),
         public.challenge_metric_unit(c.metric, ps.unit)
  from public.challenges c
  left join public.pursuit_stats ps on ps.id = c.stat_id
  where c.is_public or c.owner_id = auth.uid() or public.is_challenge_member(c.id)
  order by (c.ends_on < current_date), c.ends_on;
$$;
