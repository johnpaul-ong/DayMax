-- Clean up duplicate signups (the "three John-Paul Ongs" problem).
--
-- These are genuinely separate auth accounts — pursuit_members is keyed on
-- (pursuit_id, user_id), so one account cannot appear twice in a pursuit.
-- They came from repeated signups while the confirmation links were dead.
-- Before migration 0021 they all rendered as the same @handle because the
-- handle was just the email prefix, which made it look like one person
-- duplicated rather than three accounts.
--
-- RUN STEP 1 FIRST AND READ IT. Step 2 deletes accounts permanently.

-- ---------------------------------------------------------------------------
-- STEP 1: look before you leap. Which accounts are yours, and which have data?
-- ---------------------------------------------------------------------------
select u.id,
       u.email,
       u.created_at,
       u.last_sign_in_at,
       u.email_confirmed_at is not null                                    as confirmed,
       p.display_name,
       (select count(*) from public.day_entries d  where d.user_id = u.id) as slots,
       (select count(*) from public.lift_entries l where l.user_id = u.id) as lifts,
       (select count(*) from public.pursuit_entries e where e.user_id = u.id) as pursuit_logs
from auth.users u
left join public.profiles p on p.id = u.id
where coalesce(p.is_demo, false) = false
order by slots desc, u.created_at;

-- ---------------------------------------------------------------------------
-- STEP 2: delete the empties. Keeps every account that has ANY data, and every
-- demo account. Deleting from auth.users cascades to profiles, day_entries,
-- memberships, friendships — everything.
--
-- Uncomment to run. Check step 1 first: if the account you actually use shows
-- 0 slots, do NOT run this, or you'll delete the one you're signed in as.
-- ---------------------------------------------------------------------------
-- delete from auth.users u
--  where coalesce((select p.is_demo from public.profiles p where p.id = u.id), false) = false
--    and not exists (select 1 from public.day_entries     d where d.user_id = u.id)
--    and not exists (select 1 from public.lift_entries    l where l.user_id = u.id)
--    and not exists (select 1 from public.pursuit_entries e where e.user_id = u.id);

-- ---------------------------------------------------------------------------
-- Alternative: delete specific accounts by id, once you've picked from step 1.
-- ---------------------------------------------------------------------------
-- delete from auth.users where id in ('paste-uuid-here', 'and-another');

-- ---------------------------------------------------------------------------
-- STEP 3: confirm. Life's member count should now match the number of real
-- people (plus the six demo characters).
-- ---------------------------------------------------------------------------
select (select count(*) from auth.users)                                  as accounts,
       (select count(*) from public.profiles where is_demo)               as demo_accounts,
       (select count(*) from public.pursuit_members
         where pursuit_id = '33333333-3333-4333-8333-333333333301')       as life_members;
