-- ============================================================================
-- DayMax — delete the fabricated FUTURE days
--
-- v1 of the gap-filling workbook ran to 30 September because the all-months
-- export emitted whole months, including days that have not happened yet. Those
-- 15 days (16–30 Sep) are the flat, identical band on the right of your year
-- strip: one fixed template repeated, with no variation between days.
--
-- Import upserts and never deletes, so a new file that stops at 15 September
-- cannot remove them. This does.
--
-- Paste into the Supabase SQL editor. CHECK THE FIRST QUERY BEFORE RUNNING THE
-- SECOND — the delete is not reversible.
-- ============================================================================

-- 1. LOOK FIRST. What is about to be deleted?
with me as (select id from auth.users where email = 'jpong@ccia.org.au')  -- <<< YOUR EMAIL
select e.date,
       count(*) as slots,
       count(distinct e.category) as distinct_categories
  from public.day_entries e, me
 where e.user_id = me.id
   and e.date > date '2026-09-15'
 group by e.date
 order by e.date;

-- Expect ~15 rows, 96 slots each, all in the future. If you see dates you
-- actually logged, STOP and change the cutoff below.


-- 2. THEN DELETE. Uncomment and run.
--
-- with me as (select id from auth.users where email = 'jpong@ccia.org.au')
-- delete from public.day_entries e
--  using me
--  where e.user_id = me.id
--    and e.date > date '2026-09-15';
--
-- Day metrics for those days too, if any were written:
--
-- with me as (select id from auth.users where email = 'jpong@ccia.org.au')
-- delete from public.day_metrics m
--  using me
--  where m.user_id = me.id
--    and m.date > date '2026-09-15';
