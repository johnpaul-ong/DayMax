-- =============================================================================
-- WHERE AM I? — ONE query, ONE result set.
--
-- The Supabase SQL editor only shows the LAST statement's result when you
-- paste multiple queries, which is why the earlier version only showed the
-- row counts. This version returns EVERYTHING as a single table with two
-- columns:
--   check       — what is being asked
--   result      — the answer (comma-separated when the answer is a list)
--
-- Read-only. Nothing here creates, alters or drops anything.
-- =============================================================================

with
  db as (
    select current_database() as name, current_user as usr, current_setting('server_version') as v
  ),
  daymax_tables as (
    select coalesce(string_agg(table_name, ', ' order by table_name), '(none)') as list
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'profiles','day_entries','lift_entries','spend_entries','spend_categories',
        'spend_category_prefs','pursuits','pursuit_members','pursuit_stats','pursuit_entries',
        'challenges','challenge_members','challenge_results','friendships','tracks',
        'track_members','bucket_settings','push_subscriptions'
      )
  ),
  profile_cols as (
    select coalesce(string_agg(column_name, ', ' order by column_name), '(none)') as list
    from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
  ),
  challenge_cols as (
    select coalesce(string_agg(column_name, ', ' order by column_name), '(none)') as list
    from information_schema.columns
    where table_schema = 'public' and table_name = 'challenges'
  ),
  fns as (
    select coalesce(string_agg(proname, ', ' order by proname), '(none)') as list
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and proname in (
        'challenge_metric','challenge_metric_family','challenge_default_direction',
        'challenge_metric_unit','challenge_metric_label',
        'challenge_pursuit_allowed','challenge_stat_allowed',
        'challenge_standings','challenge_daily','challenge_categories',
        'finalize_challenge','my_challenges','join_challenge',
        'challenge_income','is_challenge_member',
        'pursuit_member_list','can_see_pursuit','is_pursuit_member'
      )
  ),
  metric_check as (
    select coalesce(
      (select pg_get_constraintdef(oid) from pg_constraint
        where conrelid = 'public.challenges'::regclass and contype = 'c'
          and pg_get_constraintdef(oid) ilike '%metric%'
        limit 1),
      '(no metric check constraint)'
    ) as def
  ),
  has_theme as (
    select case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'theme'
    ) then 'YES' else 'NO' end as v
  ),
  has_dir as (
    select case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'challenges' and column_name = 'direction'
    ) then 'YES' else 'NO' end as v
  ),
  has_ml as (
    select case when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and proname = 'challenge_metric_label'
    ) then 'YES' else 'NO' end as v
  ),
  has_pml as (
    select case when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and proname = 'pursuit_member_list'
    ) then 'YES' else 'NO' end as v
  )
select * from (
  values
    ('01. database',                (select name || ' as ' || usr || ' (pg ' || v || ')' from db)),
    ('02. daymax tables present',   (select list from daymax_tables)),
    ('03. profiles columns',        (select list from profile_cols)),
    ('04. challenges columns',      (select list from challenge_cols)),
    ('05. helper functions',        (select list from fns)),
    ('06. challenges metric check', (select def from metric_check)),
    ('07. profiles.theme column',   (select v from has_theme)),
    ('08. challenges.direction column', (select v from has_dir)),
    ('09. challenge_metric_label() exists (0038)', (select v from has_ml)),
    ('10. pursuit_member_list() exists (0039)',    (select v from has_pml))
) as x(check, result)
order by check;
