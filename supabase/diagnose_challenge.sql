-- ============================================================================
-- DayMax — why isn't my challenge income doing anything?
--
-- Paste this whole file into the Supabase SQL editor and press Run. It writes
-- nothing. The last column of the result tells you what to do.
--
-- If you get "relation public.challenges does not exist", you are in the wrong
-- Supabase project — check the project name in the top-left of the dashboard.
-- ============================================================================

with checks as (

  select 1 as ord,
         'migration 0036 applied' as check_name,
         (to_regclass('public.challenge_members') is not null
          and exists (select 1 from information_schema.columns
                       where table_schema = 'public'
                         and table_name = 'challenge_members'
                         and column_name = 'income_override')) as passed,
         'Run supabase/apply_0036.sql. Without this column the app cannot store an income at all.' as fix

  union all select 2,
         'challenge_income() exists',
         to_regproc('public.challenge_income(uuid, uuid)') is not null,
         'Run supabase/apply_0036.sql — this is the function that decides which income to judge you against.'

  union all select 3,
         'challenge_daily() exists',
         to_regproc('public.challenge_daily(uuid)') is not null,
         'Run supabase/apply_0036.sql — the race chart and daily-damage chart come from this.'

  union all select 4,
         'challenge_categories() exists',
         to_regproc('public.challenge_categories(uuid)') is not null,
         'Run supabase/apply_0036.sql — the category breakdown comes from this.'

  union all select 5,
         'challenge renamed to Budget Baddies',
         exists (select 1 from public.challenges where name = 'Budget Baddies'),
         'Run supabase/apply_0036.sql, or the challenge is simply named something else.'

  union all select 6,
         'you are a member of it',
         exists (select 1
                   from public.challenge_members m
                   join public.challenges c on c.id = m.challenge_id
                  where m.user_id = auth.uid()),
         'Open the challenge and press Join. Setting income on a challenge you have not joined updates zero rows.'
)
select case when passed then 'PASS' else 'FAIL' end as result,
       check_name,
       case when passed then '' else fix end as what_to_do
from checks
order by ord;

-- ----------------------------------------------------------------------------
-- If every line above says PASS, run this second query. It shows the income
-- the app is actually using for you, and where that number came from.
-- ----------------------------------------------------------------------------

-- select c.name,
--        m.income_override                        as your_override,
--        public.challenge_income(c.id, auth.uid()) as income_being_used,
--        case when m.income_override is not null then 'your override'
--             else 'last income entry before ' || c.starts_on::text
--        end                                       as source
--   from public.challenge_members m
--   join public.challenges c on c.id = m.challenge_id
--  where m.user_id = auth.uid();
