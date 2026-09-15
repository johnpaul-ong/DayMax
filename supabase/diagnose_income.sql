-- ============================================================================
-- DayMax — did my challenge income actually save?
--
-- Run this AFTER diagnose_challenge.sql, and only if that file's first four
-- lines all said PASS (this one calls challenge_income(), so it errors out
-- rather than reporting if 0036 is missing).
--
-- Paste the whole file into the Supabase SQL editor and press Run.
-- It writes nothing. One statement, one result table.
--
-- Reading it:
--   your_override      what you typed into the box. NULL = nothing saved.
--   income_being_used  the number the percentages are actually divided by.
--   source             where that number came from.
--
-- If your_override has your number in it, the save worked and the problem is
-- purely that the page did not show you — that fix is in the unpushed commits.
-- ============================================================================

with me as (
  select id from auth.users where email = 'jpong@ccia.org.au'   -- <<< YOUR EMAIL
)
select c.name                                as challenge,
       c.starts_on,
       c.metric                              as ranked_on,
       m.income_override                     as your_override,
       public.challenge_income(c.id, me.id)  as income_being_used,
       case when m.income_override is not null then 'your override'
            when public.challenge_income(c.id, me.id) is not null
                 then 'last income entry on or before ' || c.starts_on::text
            else 'NOTHING — every percentage will show as a dash'
       end                                   as source,
       (select count(*) from public.spend_entries e
         where e.user_id = me.id and e.date between c.starts_on and c.ends_on)
                                             as your_entries_in_window
  from public.challenge_members m
  join public.challenges c on c.id = m.challenge_id
  cross join me
 where m.user_id = me.id
 order by c.starts_on desc;
