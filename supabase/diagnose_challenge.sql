-- ============================================================================
-- DayMax — challenge health check  (v2)
--
-- HOW TO RUN: paste this whole file into the Supabase SQL editor and press Run.
-- It writes nothing. One statement, one result table.
--
-- Change the email on the marked line below if you sign in with a different one.
--
-- (v1 of this file reported three false FAILs. It used to_regproc(), which
--  takes a function NAME and returns NULL when handed an argument list — the
--  signature form is to_regprocedure(). It also relied on auth.uid(), which is
--  NULL in the SQL editor because the editor runs as postgres, not as you.)
-- ============================================================================

with me as (
  select id from auth.users where email = 'jpong@ccia.org.au'   -- <<< YOUR EMAIL
)
select case when passed then 'PASS' else 'FAIL' end as result,
       check_name,
       case when passed then '' else fix end as what_to_do
from (
  select 1 as ord,
         'income_override column exists' as check_name,
         exists (select 1 from information_schema.columns
                  where table_schema = 'public'
                    and table_name   = 'challenge_members'
                    and column_name  = 'income_override') as passed,
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

  union all select 5, 'challenge_standings() exists',
         to_regprocedure('public.challenge_standings(uuid)') is not null,
         'Run migration 0035 then apply_0036.sql.'

  union all select 6, 'challenge renamed to Budget Baddies',
         exists (select 1 from public.challenges where name = 'Budget Baddies'),
         'Run supabase/apply_0036.sql, or it is simply named something else.'

  union all select 7, 'we found your account',
         exists (select 1 from me),
         'Edit the email at the top of this file to the one you sign in with.'

  union all select 8, 'you have a challenge_members row',
         exists (select 1 from public.challenge_members m, me where m.user_id = me.id),
         'Open the challenge and press Join. An UPDATE matching zero rows is '
         || 'reported as SUCCESS by PostgREST — that is how this fails silently.'

  union all select 9, 'you have spending logged',
         exists (select 1 from public.spend_entries e, me where e.user_id = me.id),
         'Log some spending on the Money page, or the board has nothing to rank.'

  union all select 10, 'you have an income entry before 15 Sep',
         exists (select 1 from public.income_entries i, me
                  where i.user_id = me.id and i.date <= date '2026-09-15'),
         'This is the automatic fallback. With no income entry before the start date AND no '
         || 'override saved, every percentage shows as a dash — which looks exactly like nothing happening.'
) checks
order by ord;
