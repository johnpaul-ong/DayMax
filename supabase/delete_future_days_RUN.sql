-- ============================================================================
-- DayMax — PART 2: actually delete the fabricated future days
--
-- ONLY RUN THIS AFTER delete_future_days.sql (part 1) showed you a list you
-- were happy to lose. THIS IS NOT REVERSIBLE.
--
-- One statement. Deletes from day_entries and day_metrics in the same
-- transaction, then reports what went. If the counts come back 0, nothing
-- matched and nothing was lost.
--
-- The cutoff appears twice. Change BOTH if you change it.
-- ============================================================================

with me as (
  select id from auth.users where email = 'jpong@ccia.org.au'   -- <<< YOUR EMAIL
),
gone_entries as (
  delete from public.day_entries e
   using me
   where e.user_id = me.id
     and e.date > date '2026-09-15'
  returning e.date
),
gone_metrics as (
  delete from public.day_metrics m
   using me
   where m.user_id = me.id
     and m.date > date '2026-09-15'
  returning m.date
)
select 'day_entries' as source,
       count(*)                       as rows_deleted,
       count(distinct date)           as days,
       min(date)                      as first_day,
       max(date)                      as last_day
  from gone_entries
union all
select 'day_metrics',
       count(*),
       count(distinct date),
       min(date),
       max(date)
  from gone_metrics;

-- Expect roughly: day_entries 1440 rows / 15 days / 2026-09-16 -> 2026-09-30.
--
-- Then confirm nothing past today survives — this should return no rows:
--
-- with me as (select id from auth.users where email = 'jpong@ccia.org.au')
-- select e.date, count(*) from public.day_entries e, me
--  where e.user_id = me.id and e.date > date '2026-09-15'
--  group by e.date order by e.date;
--
-- After that, import daymax_filled.xlsx.
