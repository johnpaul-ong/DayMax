-- DayMax migration 32: let a person delete their own account.
--
-- There was no way out. Export existed, deletion didn't — which is a trust
-- problem before it's a legal one, and it's a hard requirement if this ever
-- ships in an app store.
--
-- Clients cannot touch auth.users, so this has to be a SECURITY DEFINER
-- function. Everything else cascades from the auth.users row: profiles,
-- day_entries, day_metrics, daily_metrics, lift_entries, lift_goals,
-- friendships, track_members, pursuit_members, pursuit_entries, posts and
-- comments all declare `on delete cascade`.

create or replace function public.delete_my_account(confirm text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;

  -- A typed confirmation, so a stray RPC call can never nuke an account.
  if confirm is distinct from 'DELETE' then
    raise exception 'Type DELETE to confirm';
  end if;

  -- Demo accounts are shared scenery; they are not anyone's to delete.
  if exists (select 1 from public.profiles p where p.id = me and p.is_demo) then
    raise exception 'Demo accounts cannot be deleted';
  end if;

  -- Hand ownership of anything shared to nobody rather than deleting it out
  -- from under other people: a pursuit you started that others now use becomes
  -- ownerless (built-in) instead of vanishing with your account.
  update public.pursuits set owner_id = null
   where owner_id = me
     and exists (select 1 from public.pursuit_members m
                  where m.pursuit_id = pursuits.id and m.user_id <> me);

  -- Tracks are small and private by nature; if you owned one, it goes.
  delete from public.tracks where owner_id = me;

  delete from auth.users where id = me;   -- everything else cascades
end $$;

revoke all on function public.delete_my_account(text) from anon;
grant execute on function public.delete_my_account(text) to authenticated;
