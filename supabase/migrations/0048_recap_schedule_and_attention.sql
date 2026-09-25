-- DayMax migration 48: recaps publish themselves at close time, and an
-- attention list for the admin.
--
-- 1. An approved recap stays hidden from members until the challenge closes
--    (challenge_closes_at: 12:00 the day after ends_on). Approving early
--    schedules it; approving after close publishes it immediately. No cron —
--    the clock is in the RLS policy.
--
-- 2. agent_attention(): what needs the admin right now. Read-only, and
--    REVOKED from anon/authenticated so the app can't call it; it is for an
--    admin session talking to the database directly. See AGENTS.md
--    ("Admin attention queue").

-- ---------------------------------------------------------------------------
-- 1. Recaps appear at close time
-- ---------------------------------------------------------------------------

drop policy if exists "members see approved recaps" on public.challenge_recaps;
create policy "members see approved recaps" on public.challenge_recaps
  for select using (
    public.is_daymax_admin()
    or (status = 'visible'
        and now() >= public.challenge_closes_at(challenge_id)
        and public.is_challenge_member(challenge_id))
  );

-- ---------------------------------------------------------------------------
-- 2. What needs the admin's attention
-- ---------------------------------------------------------------------------

create or replace function public.agent_attention()
returns table (kind text, ref uuid, title text, detail text, due_at timestamptz)
language sql security definer stable set search_path = public as $$
  with ch as (
    select c.id, c.name, public.challenge_closes_at(c.id) as closes_at,
           (select count(*) from public.challenge_members m where m.challenge_id = c.id) as members,
           (select count(*) from public.challenge_recaps r where r.challenge_id = c.id and r.status = 'visible') as approved,
           (select count(*) from public.challenge_recaps r where r.challenge_id = c.id and r.status = 'pending_approval') as pending
    from public.challenges c
    -- ended within the last month
    where c.ends_on < (now() at time zone 'Australia/Sydney')::date
      and c.ends_on > (now() at time zone 'Australia/Sydney')::date - 30
  )
  select 'recaps_needed'::text, ch.id, ch.name,
         format('%s of %s members have an approved recap. %s', ch.approved, ch.members,
                case when now() < ch.closes_at
                     then 'Final logs still open: numbers are provisional until due_at, when approved recaps publish.'
                     else 'Closed: numbers are final; approved recaps publish immediately.' end),
         ch.closes_at
  from ch where ch.approved < ch.members
  union all
  select 'recaps_pending_approval', ch.id, ch.name,
         format('%s draft(s) waiting for approval.', ch.pending), ch.closes_at
  from ch where ch.pending > 0
  union all
  select 'pursuit_requests', null::uuid, 'Pursuit requests',
         format('%s request(s) waiting for review at /admin/pursuit-requests.', count(*)), min(created_at)
  from public.pursuit_requests where status = 'pending'
  having count(*) > 0
  order by 5 nulls last;
$$;

revoke all on function public.agent_attention() from public, anon, authenticated;
