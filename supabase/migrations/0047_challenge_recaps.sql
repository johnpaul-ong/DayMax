-- DayMax migration 47: end-of-challenge recaps.
--
-- When a challenge ends, each member gets a short written recap of how they
-- did. The admin drafts them (a server action asks Claude, see
-- src/app/admin/recaps/actions.ts), edits if needed, and approves. Only an
-- approved recap is ever visible to members.
--
-- Why a table and not a column on challenge_results: members can SELECT
-- challenge_results, and RLS is row-level — a draft column there would be
-- readable before the admin approved it. Here the row itself is hidden until
-- status = 'visible'.
--
-- Also adds challenge_life_summary(): per-member hours by bucket for a life
-- challenge. challenge_standings only returns the ranked score, and a recap
-- that says "31.4 WorkMax" without the productive/brainrot hours behind it
-- says nothing. Same gate and same bucket rulebook as challenge_standings, so
-- it exposes nothing a member couldn't already work out from the board.

-- ---------------------------------------------------------------------------
-- 1. Recaps
-- ---------------------------------------------------------------------------

create table if not exists public.challenge_recaps (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 2000),
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'visible')),
  model text,
  generated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create index if not exists challenge_recaps_status_idx on public.challenge_recaps (status, challenge_id);
alter table public.challenge_recaps enable row level security;

drop policy if exists "members see approved recaps" on public.challenge_recaps;
create policy "members see approved recaps" on public.challenge_recaps
  for select using (
    public.is_daymax_admin()
    or (status = 'visible' and public.is_challenge_member(challenge_id))
  );

drop policy if exists "admin writes recaps" on public.challenge_recaps;
create policy "admin writes recaps" on public.challenge_recaps
  for all using (public.is_daymax_admin()) with check (public.is_daymax_admin());

-- ---------------------------------------------------------------------------
-- 2. Life breakdown per member
-- ---------------------------------------------------------------------------

create or replace function public.challenge_life_summary(c uuid)
returns table (
  user_id uuid, display_name text,
  productive_hours numeric, brainrot_hours numeric, sleep_hours numeric,
  days_logged bigint, focus numeric, workmax numeric
)
language plpgsql security definer stable set search_path = public as $$
declare
  ch public.challenges%rowtype;
  win_end date;
begin
  select * into ch from public.challenges where id = c;
  if ch.id is null then raise exception 'No such challenge'; end if;
  if not public.is_challenge_member(c) and ch.owner_id is distinct from auth.uid() then
    raise exception 'Join this challenge to see the standings';
  end if;
  if public.challenge_metric_family(ch.metric) <> 'life' then return; end if;
  win_end := least(current_date, ch.ends_on);

  return query
  with rules as (
    select g.category,
           coalesce(bs.bucket,
             case when g.category in (1, 2) then 'productive'
                  when g.category in (6, 9) then 'brainrot'
                  else 'other' end) as bucket
    from (select generate_series(0, 9) as category) g
    left join public.bucket_settings bs
      on bs.category = g.category and bs.user_id = ch.owner_id
  ),
  life as (
    select mb.user_id as uid,
           coalesce(sum(case when r.bucket = 'productive' then 0.25 else 0 end), 0) as ph,
           coalesce(sum(case when r.bucket = 'brainrot'   then 0.25 else 0 end), 0) as bh,
           coalesce(sum(case when e.category = 0          then 0.25 else 0 end), 0) as sh,
           count(distinct e.date) as dlogged
    from public.challenge_members mb
    left join public.day_entries e
      on e.user_id = mb.user_id and e.date between ch.starts_on and win_end
    left join rules r on r.category = e.category
    where mb.challenge_id = c
    group by mb.user_id
  )
  select l.uid, coalesce(pr.display_name, 'anonymous'),
         l.ph, l.bh, l.sh, l.dlogged,
         case when l.ph + l.bh > 0 then round(l.ph / (l.ph + l.bh) * 100, 1) end,
         case when l.ph + l.bh > 0 then round(l.ph / (l.ph + l.bh) * l.ph, 1) end
  from life l
  left join public.profiles pr on pr.id = l.uid
  order by l.uid;
end $$;

grant execute on function public.challenge_life_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Final-logs grace: nothing freezes before midday the day after the end
-- ---------------------------------------------------------------------------
--
-- People log their last day the next morning. Freezing at midnight UTC (10am
-- in Sydney) locked those logs out of the result. Results now freeze no
-- earlier than 12:00 on the day after ends_on, in the owner's timezone
-- (profiles.timezone, falling back to Sydney, where DayMax's users are). The
-- client mirrors this in challengeClosed() so the page stays live until then.

create or replace function public.challenge_closes_at(c uuid)
returns timestamptz language plpgsql security definer stable set search_path = public as $$
declare
  ch public.challenges%rowtype;
  tz text;
begin
  select * into ch from public.challenges where id = c;
  select nullif(p.timezone, '') into tz from public.profiles p where p.id = ch.owner_id;
  begin
    return ((ch.ends_on + 1)::timestamp + interval '12 hours') at time zone coalesce(tz, 'Australia/Sydney');
  exception when others then
    return ((ch.ends_on + 1)::timestamp + interval '12 hours') at time zone 'Australia/Sydney';
  end;
end $$;

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
  if now() < public.challenge_closes_at(c) then
    raise exception 'Final logs are still open until 12:00 on %', (ch.ends_on + 1);
  end if;

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
