-- Demo visitor part 2: things that key off auth.uid() instead of being
-- RLS-filtered — "Your life" (needs birth_date on the SIGNED-IN profile),
-- display_name shown around the UI, and challenge membership (my_challenges
-- RPC filters to rows the caller is a member of).
--
-- RLS impersonation (0049) can't fix these because the SQL isn't asking
-- "which rows belong to who", it's asking "what's on my own row" or
-- "which rows name me as member". Fix by COPYING the owner's profile fields
-- into the demo profile, and inserting demo as a member of every challenge
-- the owner is a member of. Runs on every visitor sign-in so clones stay
-- fresh if the owner updates their DOB / joins a new challenge.
--
-- SECURITY: security-definer function, but the FIRST STATEMENT refuses the
-- call unless the caller is signed into the demo account. So an authenticated
-- stranger who somehow invokes it gets an exception, not a write — the
-- elevated privileges only ever modify the single demo profile row and the
-- demo's challenge_members rows. Execute grant limited to `authenticated`;
-- anon cannot invoke it.

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
    return;   -- demo account not yet created; harmless no-op
  end if;

  -- Refuse unless the caller is the demo user. This bounds what the
  -- security-definer elevation can do — any other authenticated user who
  -- tries to invoke this gets an exception.
  if auth.uid() is distinct from demo then
    raise exception 'daymax_sync_demo_from_owner can only be invoked by the demo account';
  end if;

  update public.profiles d
     set display_name       = o.display_name,
         birth_date         = o.birth_date,
         country            = o.country,
         timezone           = o.timezone,
         target_weight_kg   = o.target_weight_kg,
         default_exercise   = o.default_exercise,
         currency           = o.currency
    from public.profiles o
   where d.id = demo
     and o.id = owner;

  delete from public.challenge_members where user_id = demo;
  insert into public.challenge_members (challenge_id, user_id, share_amounts)
  select m.challenge_id, demo, m.share_amounts
    from public.challenge_members m
   where m.user_id = owner;
end
$$;

grant execute on function public.daymax_sync_demo_from_owner() to authenticated;
