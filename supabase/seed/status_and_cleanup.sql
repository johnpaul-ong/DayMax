-- DayMax: what's actually applied, who the accounts are, and how to remove
-- the duplicates. Run section by section. Only section 3 changes anything.

-- ===========================================================================
-- 1. WHICH MIGRATIONS HAVE LANDED
--    Each row checks for something that migration created. "applied = false"
--    means that migration has not run (or failed part-way).
-- ===========================================================================
select '0017 member_day_strip(uuid,date,date)' as migration,
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'member_day_strip' and p.pronargs = 3) as applied
union all
select '0018 profiles.timezone',
       exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'profiles' and column_name = 'timezone')
union all
select '0019 leaderboard_day_totals(date,date)',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'leaderboard_day_totals' and p.pronargs = 2)
union all
select '0020 pursuit_member_list()',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'pursuit_member_list')
union all
select '0021 profiles.username',
       exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'profiles' and column_name = 'username')
union all
select '0021 profiles.username_chosen',
       exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'profiles' and column_name = 'username_chosen')
union all
select '0021 unique username index',
       exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'profiles_username_key')
order by migration;

-- If '0021 profiles.username' is TRUE but you still see three identical
-- @handles in the UI, the handles are fine and the page is stale — hard-refresh.
-- Three identical handles CANNOT exist once the unique index above is in place.


-- ===========================================================================
-- 1b. GROUND TRUTH ON ACCOUNTS
--     The dashboard Users list paginates and can look complete when it isn't.
--     This is the real count, and the real Life roster.
-- ===========================================================================
select count(*) as total_auth_users from auth.users;

-- every account, no filtering, no pagination
select u.id, u.email, u.created_at, u.email_confirmed_at, u.last_sign_in_at
from auth.users u
order by u.created_at;

-- the actual rows behind "N in this pursuit" for Life. If this returns 7 rows
-- but the UI drew 9 chips, the bug is client-side and I need to know.
select m.user_id, p.display_name, p.username, u.email, m.role, m.joined_at
from public.pursuit_members m
join auth.users u on u.id = m.user_id
left join public.profiles p on p.id = m.user_id
where m.pursuit_id = '33333333-3333-4333-8333-333333333301'
order by m.joined_at;

-- orphaned profile rows: a profile whose auth user is gone. Shouldn't be
-- possible (FK cascade), but worth ruling out.
select p.id, p.display_name, p.username
from public.profiles p
left join auth.users u on u.id = p.id
where u.id is null;


-- ===========================================================================
-- 1c. DID YOUR FRIEND'S SIGNUP ACTUALLY LAND?
--     Put her address in below. An account that exists but was never
--     confirmed still appears here — with email_confirmed_at null.
-- ===========================================================================
select u.id, u.email, u.created_at, u.email_confirmed_at, u.last_sign_in_at,
       u.raw_app_meta_data ->> 'provider' as provider
from auth.users u
where u.email ilike '%her-address-here%';

-- ...and anything half-created: an identity row with no usable user
select i.provider, i.identity_data ->> 'email' as email, i.created_at, i.user_id
from auth.identities i
order by i.created_at desc
limit 20;


-- ===========================================================================
-- 2. WHO THESE ACCOUNTS ARE — the emails you asked about
-- ===========================================================================
select u.id,
       u.email,
       u.created_at::date                                                    as signed_up,
       u.last_sign_in_at::date                                               as last_seen,
       u.email_confirmed_at is not null                                      as confirmed,
       p.display_name,
       p.username,
       (select count(*) from public.day_entries     d where d.user_id = u.id) as slots,
       (select count(*) from public.lift_entries    l where l.user_id = u.id) as lifts,
       (select count(*) from public.pursuit_entries e where e.user_id = u.id) as pursuit_logs
from auth.users u
left join public.profiles p on p.id = u.id
where coalesce(p.is_demo, false) = false
order by slots desc, u.created_at;


-- ===========================================================================
-- 3. DELETE THE EMPTY DUPLICATES  *** THIS ONE DELETES DATA ***
--    Keeps every account with any data, and every demo account.
--    Look at section 2 first. If the account you sign in with shows slots = 0,
--    do NOT run this — delete the others by id instead (see 3b).
-- ===========================================================================
-- 3a. the safe sweep: accounts that have never logged anything
delete from auth.users u
 where coalesce((select p.is_demo from public.profiles p where p.id = u.id), false) = false
   and not exists (select 1 from public.day_entries     d where d.user_id = u.id)
   and not exists (select 1 from public.lift_entries    l where l.user_id = u.id)
   and not exists (select 1 from public.pursuit_entries e where e.user_id = u.id);

-- 3b. or delete specific ones, once you've picked them from section 2:
-- delete from auth.users where id in ('paste-uuid', 'paste-another-uuid');


-- ===========================================================================
-- 4. CONFIRM
-- ===========================================================================
select (select count(*) from auth.users)                                as accounts,
       (select count(*) from public.profiles where is_demo)             as demo_accounts,
       (select count(*) from public.pursuit_members
         where pursuit_id = '33333333-3333-4333-8333-333333333301')     as life_members;
