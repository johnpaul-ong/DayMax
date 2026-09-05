-- DayMax migration 22: stop the same person quietly ending up with several
-- accounts.
--
-- WHAT SUPABASE ALREADY DOES: one account per email address, enforced on
-- auth.users. You cannot sign up twice with the exact same string.
--
-- WHAT SLIPS THROUGH: plus-addressing and case. jpong@x.com, JPong@x.com and
-- jpong+test@x.com are three different strings and therefore three accounts,
-- which is how a "duplicate" person appears in a pursuit. This normalises
-- those away and blocks the second signup.
--
-- WHAT IT DELIBERATELY DOES NOT DO: treat different domains as the same person.
-- jpong@ccia.org.au and jpong@gmail.com stay separate accounts, because there
-- is no safe way to tell "my other address" from "a different human with a
-- common name".

create or replace function public.normalize_email(e text)
returns text language sql immutable as $$
  select lower(split_part(split_part(coalesce(e, ''), '@', 1), '+', 1))
      || '@'
      || lower(split_part(coalesce(e, ''), '@', 2));
$$;

create or replace function public.block_duplicate_signup()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  existing text;
begin
  select u.email into existing
  from auth.users u
  where u.id <> new.id
    and public.normalize_email(u.email) = public.normalize_email(new.email)
  limit 1;

  if existing is not null then
    raise exception 'An account already exists for % — sign in with it, or use "forgot password".', existing
      using errcode = 'unique_violation';
  end if;
  return new;
end $$;

drop trigger if exists block_duplicate_signup on auth.users;
create trigger block_duplicate_signup
  before insert on auth.users
  for each row execute function public.block_duplicate_signup();

-- Find any duplicates that already exist, so you can merge or delete them.
-- (Read-only — this is a report, not a change.)
create or replace function public.duplicate_accounts()
returns table (normalized text, accounts bigint, emails text[], ids uuid[])
language sql security definer stable set search_path = public as $$
  select public.normalize_email(u.email),
         count(*),
         array_agg(u.email order by u.created_at),
         array_agg(u.id order by u.created_at)
  from auth.users u
  group by 1
  having count(*) > 1;
$$;
