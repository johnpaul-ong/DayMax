-- Visitor v2 fix: strip owner identity + challenge membership from demo.
--
-- 0050 copied the owner's display_name into demo and inserted demo as a
-- member of every challenge the owner was in. That made the owner's own
-- leaderboard (Grindset Goblins etc) show "John-Paul Ong" twice — once
-- the real account, once the demo wearing the same name. Fix:
--
--   1. Rename demo back to "Visitor" at the profile level and keep it
--      there. Visitors see "Visitor" as their display name; owner's
--      leaderboards and friend lists stop showing a dup.
--   2. Delete demo from challenge_members entirely. Visitor sees empty
--      challenges tab — explicit choice over the dup bug.
--   3. Rewrite daymax_sync_demo_from_owner to NOT copy display_name and
--      NOT re-insert challenge_members. Still copies DOB, country,
--      timezone, target_weight_kg, default_exercise, currency so "Your
--      life" numbers and defaults are correct for the visitor.

create or replace function public.daymax_sync_demo_from_owner()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := public.daymax_demo_owner_uid();
  demo  uuid;
begin
  select id into demo from auth.users where email = 'demo@daymax.app';
  if demo is null then
    return;
  end if;

  if auth.uid() is not null and auth.uid() is distinct from demo then
    raise exception 'daymax_sync_demo_from_owner can only be invoked by the demo account';
  end if;

  -- Owner's non-identity profile fields: these drive "Your life" (DOB),
  -- unit/locale defaults, and the default exercise on the Lifts page.
  -- Explicitly NOT copying display_name — demo stays "Visitor".
  update public.profiles d
     set birth_date         = o.birth_date,
         country            = o.country,
         timezone           = o.timezone,
         target_weight_kg   = o.target_weight_kg,
         default_exercise   = o.default_exercise,
         currency           = o.currency
    from public.profiles o
   where d.id = demo
     and o.id = owner;
end
$$;

-- One-shot repairs: pin demo's display_name back to "Visitor", drop its
-- challenge membership so the owner's leaderboards go back to normal.
do $$
declare
  demo uuid;
begin
  select id into demo from auth.users where email = 'demo@daymax.app';
  if demo is null then
    return;
  end if;

  update public.profiles set display_name = 'Visitor' where id = demo;
  delete from public.challenge_members where user_id = demo;
end $$;
