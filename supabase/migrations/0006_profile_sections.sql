-- DayMax migration 6: friend profile pages.
-- Each user chooses which sections friends can see on their profile.
-- Default: productivity ranking, hours per day/week/month, lifts.

alter table public.profiles
  add column if not exists profile_sections jsonb not null default '["ranking","hours","lifts"]'::jsonb;

-- Read a fellow member's name + profile section choices.
-- Allowed only if you share at least one track with them (or it's you).
create function public.member_profile(member uuid)
returns table (display_name text, sections jsonb)
language plpgsql security definer stable set search_path = public as $$
begin
  if member <> auth.uid() and not exists (
    select 1
    from public.track_members a
    join public.track_members b on a.track_id = b.track_id
    where a.user_id = auth.uid() and b.user_id = member
  ) then
    raise exception 'You do not share a track with this person';
  end if;
  return query
  select coalesce(p.display_name, 'anonymous'), coalesce(p.profile_sections, '["ranking","hours","lifts"]'::jsonb)
  from public.profiles p where p.id = member;
end $$;
