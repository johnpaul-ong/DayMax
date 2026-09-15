-- Which database am I connected to, and what's actually in it?
-- Run this in the Supabase SQL editor of the project that errored.

-- 1. Project identity. Compare this to NEXT_PUBLIC_SUPABASE_URL in Vercel —
--    if they differ, you ran the migration against the wrong project.
select current_database() as db, current_user as role, version();

-- 2. Which DayMax tables exist? Anything false here means the migration that
--    creates it never ran on THIS database.
select t as table_name, to_regclass('public.' || t) is not null as exists
from unnest(array[
  'profiles','day_entries','day_metrics','lift_entries','lift_goals',
  'tracks','track_members','invites','friendships',
  'pursuits','pursuit_members','pursuit_stats','pursuit_entries',
  'track_posts','track_comments','push_subscriptions',
  'spend_categories','spend_entries','income_entries','challenges'
]) t
order by 2, 1;

-- 3. How far did the migrations get? Each of these was added by a specific one.
select 'pursuits (0013)'        as feature, to_regclass('public.pursuits') is not null as applied
union all select 'usernames (0021)', exists (select 1 from information_schema.columns
  where table_name='profiles' and column_name='username')
union all select 'teams (0027)', exists (select 1 from information_schema.columns
  where table_name='profiles' and column_name='theme')
union all select 'push (0033)', to_regclass('public.push_subscriptions') is not null
union all select 'money (0034)', to_regclass('public.spend_entries') is not null
union all select 'challenges (0035)', to_regclass('public.challenges') is not null;
