-- Who is actually in the Life pursuit, and which of them are duplicate accounts?
-- Run in the Supabase SQL editor. Read-only.

-- 1. The roster, straight from the table. pursuit_members is keyed on
--    (pursuit_id, user_id), so nobody can appear twice — if you see your name
--    more than once, those are genuinely separate accounts.
select m.user_id,
       p.display_name,
       u.email,
       u.created_at            as signed_up,
       u.last_sign_in_at,
       u.email_confirmed_at is not null as confirmed,
       p.is_demo,
       (select count(*) from public.day_entries d where d.user_id = m.user_id) as slots_logged
from public.pursuit_members m
join auth.users u        on u.id = m.user_id
left join public.profiles p on p.id = m.user_id
where m.pursuit_id = '33333333-3333-4333-8333-333333333301'
order by p.is_demo, u.created_at;

-- 2. The three numbers the UI shows, side by side, so you can see which is which.
select
  (select count(*) from public.pursuit_members
     where pursuit_id = '33333333-3333-4333-8333-333333333301')          as header_member_count,
  (select count(*) from auth.users)                                       as total_accounts,
  (select count(distinct d.user_id) from public.day_entries d
     where d.date >= current_date - 84)                                   as people_with_recent_data;

-- 3. Accounts that never confirmed / never logged anything — the leftovers of a
--    failed signup. Deleting one from Authentication -> Users cascades and
--    removes its Life membership too.
select u.id, u.email, u.created_at, u.email_confirmed_at is not null as confirmed,
       (select count(*) from public.day_entries d where d.user_id = u.id) as slots_logged
from auth.users u
left join public.profiles p on p.id = u.id
where coalesce(p.is_demo, false) = false
  and (u.email_confirmed_at is null
       or not exists (select 1 from public.day_entries d where d.user_id = u.id))
order by u.created_at;
