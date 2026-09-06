-- DayMax migration 28: a profile shows everything by default, new pursuits are
-- public by default, and the Avengers stay out of the everyone-pursuit.

-- 1. Full profiles as standard ------------------------------------------------
-- The default was ["ranking","hours","lifts"], which quietly hid the year
-- heatmap, the 15-minute grid and the how-you-felt chart — the parts that make
-- a profile worth opening. All five sections are now on by default, for
-- friends and for the public.

alter table public.profiles
  alter column public_sections set default '["ranking","hours","lifts","metrics","days"]'::jsonb;
alter table public.profiles
  alter column profile_sections set default '["ranking","hours","lifts","metrics","days"]'::jsonb;

-- bring existing accounts up to the new default, without clobbering anyone who
-- has deliberately trimmed theirs down
update public.profiles
   set profile_sections = '["ranking","hours","lifts","metrics","days"]'::jsonb
 where profile_sections is null
    or profile_sections = '["ranking","hours","lifts"]'::jsonb;

update public.profiles
   set public_sections = '["ranking","hours","lifts","metrics","days"]'::jsonb
 where public_sections is null
    or public_sections = '["ranking","hours","lifts"]'::jsonb;

-- the fallbacks inside the readers have to agree with the column defaults
create or replace function public.visible_sections(member uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select case
    when member = auth.uid()
      then coalesce(p.profile_sections, '["ranking","hours","lifts","metrics","days"]'::jsonb)
    when public.is_connected(member)
      then coalesce(p.profile_sections, '["ranking","hours","lifts","metrics","days"]'::jsonb)
    when p.is_public
      then coalesce(p.public_sections, '["ranking","hours","lifts","metrics","days"]'::jsonb)
    else '[]'::jsonb
  end
  from public.profiles p where p.id = member;
$$;

-- 2. New pursuits are public --------------------------------------------------
-- A pursuit nobody can find is a pursuit nobody joins. Invite-only stays
-- available, it just stops being the default.

alter table public.pursuits alter column is_public set default true;

-- Existing user-made pursuits are left as their owners set them. If you want
-- to open them all up (fine on a small install, rude on a big one), run:
--
--   update public.pursuits set is_public = true where owner_id is not null;
--
-- Or flip a single one from its own page: "Make public".

-- 3. Belt and braces: the Avengers are not in the everyone-pursuit ------------
-- 0026 does this too. Repeated here because migration 0013's seed re-adds
-- every auth user to Life, so anyone who re-ran 0013 after 0026 got them back.

delete from public.pursuit_members
 where pursuit_id = '33333333-3333-4333-8333-333333333301'
   and user_id in (select id from public.profiles where is_demo);

delete from public.pursuit_members
 where pursuit_id = '33333333-3333-4333-8333-333333333303'
   and user_id in (select id from public.profiles where is_demo);

insert into public.pursuit_members (pursuit_id, user_id, role)
select '33333333-3333-4333-8333-333333333304'::uuid, p.id, 'member'
from public.profiles p where p.is_demo
on conflict do nothing;

-- Check it: this should return zero rows.
--   select p.display_name from public.pursuit_members m
--   join public.profiles p on p.id = m.user_id
--   where m.pursuit_id = '33333333-3333-4333-8333-333333333301' and p.is_demo;
