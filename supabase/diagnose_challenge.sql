-- ============================================================================
-- DayMax — why isn't my challenge income doing anything?  (v2)
--
-- v1 of this file was wrong in two ways and produced three false FAILs:
--
--   1. It used to_regproc('f(uuid, uuid)'). to_regproc takes a function NAME
--      ONLY — hand it an argument list and it returns NULL no matter what
--      exists. The correct function for a signature is to_regprocedure().
--   2. It called auth.uid(). The SQL editor runs as the postgres role, not as
--      a signed-in user, so auth.uid() is NULL there and any check built on it
--      fails for everyone, always.
--
-- So: put your email in the line below, then run the whole file.
-- It still writes nothing.
-- ============================================================================

\set ON_ERROR_STOP off

with me as (
  -- ↓↓↓ YOUR EMAIL HERE ↓↓↓
  select id from auth.users where email = 'jpong@ccia.org.au'
),
checks as (

  select 1 as ord,
         'income_override column exists' as check_name,
         exists (select 1 from information_schema.columns
                  where table_schema = 'public'
                    and table_name = 'challenge_members'
                    and column_name = 'income_override') as passed,
         'Run supabase/apply_0036.sql.' as fix

  union all select 2, 'challenge_income() exists',
         to_regprocedure('public.challenge_income(uuid, uuid)') is not null,
         'Run supabase/apply_0036.sql.'

  union all select 3, 'challenge_daily() exists',
         to_regprocedure('public.challenge_daily(uuid)') is not null,
         'Run supabase/apply_0036.sql.'

  union all select 4, 'challenge_categories() exists',
         to_regprocedure('public.challenge_categories(uuid)') is not null,
         'Run supabase/apply_0036.sql.'

  union all select 5, 'challenge renamed to Budget Baddies',
         exists (select 1 from public.challenges where name = 'Budget Baddies'),
         'Run supabase/apply_0036.sql, or it is simply named something else.'

  union all select 6, 'we found your account',
         exists (select 1 from me),
         'Edit the email at the top of this file to the one you sign in with.'

  union all select 7, 'you have a challenge_members row',
         exists (select 1 from public.challenge_members m, me
                  where m.user_id = me.id),
         'Open the challenge and press Join. An UPDATE that matches zero rows '
         || 'is reported as SUCCESS by PostgREST, which is exactly how this fails silently.'
)
select case when passed then 'PASS' else 'FAIL' end as result, check_name,
       case when passed then '' else fix end as what_to_do
from checks order by ord;


-- ----------------------------------------------------------------------------
-- What income is actually being used for you, and where it came from.
-- Run this second (it returns no rows if you have not joined anything).
-- ----------------------------------------------------------------------------
with me as (select id from auth.users where email = 'jpong@ccia.org.au')
select c.name,
       c.starts_on,
       m.income_override                    as your_override,
       public.challenge_income(c.id, me.id) as income_being_used,
       case when m.income_override is not null then 'your override'
            else 'last income entry on or before ' || c.starts_on::text
       end                                  as source
  from public.challenge_members m
  join public.challenges c on c.id = m.challenge_id
  cross join me
 where m.user_id = me.id;
