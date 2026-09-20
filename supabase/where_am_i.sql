-- =============================================================================
-- WHERE AM I? — read-only DB probe.
--
-- Nothing here writes, alters, drops or creates. Every statement is a SELECT.
-- Paste the whole file into the Supabase SQL editor and share the output;
-- I can then tell you EXACTLY which migrations you still need to run.
--
-- The point is to first confirm you're on the DayMax database (and not, say,
-- an empty side project you clicked into) and then tell you what schema state
-- that DB is actually in.
-- =============================================================================

-- 1. Which project / database am I connected to right now?
--    If `current_database` isn't 'postgres' (Supabase's default) something is
--    unusual. `inet_server_addr()` and the schema list are just extra
--    context to disambiguate.
select
  current_database()                                as db_name,
  current_user                                      as db_user,
  current_setting('server_version')                 as pg_version,
  now()                                             as when_ran;

-- 2. Do the DayMax tables exist at all? If this returns 0 rows,
--    you are on the WRONG database — nothing to fix here, switch project.
select table_name
  from information_schema.tables
 where table_schema = 'public'
   and table_name in (
     'profiles', 'day_entries', 'lift_entries',
     'spend_entries', 'spend_categories', 'spend_category_prefs',
     'pursuits', 'pursuit_members', 'pursuit_stats', 'pursuit_entries',
     'challenges', 'challenge_members', 'challenge_results',
     'friendships', 'tracks', 'track_members',
     'bucket_settings', 'push_subscriptions'
   )
 order by table_name;

-- 3. Does profiles have the columns the app writes to?
--    theme+accent = migration 0014
--    username, display_name, is_demo = various
select column_name, data_type, column_default, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'profiles'
 order by ordinal_position;

-- 4. Does challenges have the columns migration 0038 adds?
--    direction+stat_id are the new ones. If they're missing, 0038 hasn't run.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'challenges'
 order by ordinal_position;

-- 5. Which helper functions actually exist?
--    challenge_metric* = 0038 metric vocabulary
--    challenge_standings/daily/categories = 0038 standings functions
--    pursuit_member_list = 0039 (member list)
--    challenge_income = 0036 (Budget Baddies)
select proname, pg_get_function_arguments(oid) as args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and proname in (
     'challenge_metric', 'challenge_metric_family',
     'challenge_default_direction', 'challenge_metric_unit', 'challenge_metric_label',
     'challenge_pursuit_allowed', 'challenge_stat_allowed',
     'challenge_standings', 'challenge_daily', 'challenge_categories',
     'finalize_challenge', 'my_challenges', 'join_challenge',
     'challenge_income', 'is_challenge_member',
     'pursuit_member_list', 'can_see_pursuit', 'is_pursuit_member'
   )
 order by proname;

-- 6. What is the current metric constraint on challenges (so I can tell
--    whether 0038's new metric list is in place)?
select conname, pg_get_constraintdef(oid) as def
  from pg_constraint
 where conrelid = 'public.challenges'::regclass
   and contype = 'c';

-- 7. Sanity: any row counts, just to prove there is REAL data here (not an
--    empty dev DB that looks right structurally but is somebody else's).
select 'profiles'     as tbl, (select count(*) from public.profiles)      as rows
union all select 'day_entries',   (select count(*) from public.day_entries)
union all select 'spend_entries', (select count(*) from public.spend_entries)
union all select 'pursuits',      (select count(*) from public.pursuits)
union all select 'challenges',    (select count(*) from public.challenges);
