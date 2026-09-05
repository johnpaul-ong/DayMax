-- DayMax migration 7: demo accounts visible to everyone + Arena leaderboard.
-- Demo users/tracks are flagged is_demo; the membership check treats demo
-- tracks as readable by any signed-in user (write access is unchanged: nobody
-- can write to demo data because RLS insert/update still requires user_id = auth.uid()).

alter table public.profiles add column if not exists is_demo boolean not null default false;
alter table public.tracks add column if not exists is_demo boolean not null default false;

-- membership now includes "it's a demo track" (functions + policies all route through this)
create or replace function public.is_track_member(t uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.track_members m where m.track_id = t and m.user_id = auth.uid())
      or exists (select 1 from public.tracks tr where tr.id = t and tr.is_demo);
$$;

-- everyone can see demo tracks in their list
create policy "demo tracks are visible" on public.tracks
  for select using (is_demo);

-- demo profiles are viewable without sharing a track
create or replace function public.member_profile(member uuid)
returns table (display_name text, sections jsonb)
language plpgsql security definer stable set search_path = public as $$
begin
  if member <> auth.uid()
     and not exists (select 1 from public.profiles p where p.id = member and p.is_demo)
     and not exists (
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

-- Arena: per-day bucket totals for every user the caller may see —
-- demo users + anyone sharing a track with the caller (share_rule respected).
create function public.leaderboard_day_totals()
returns table (member_id uuid, display_name text, is_demo boolean, date date, productive numeric, brainrot numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  return query
  with visible as (
    select p.id, coalesce(p.display_name, 'anonymous') as name, p.is_demo
    from public.profiles p
    where p.is_demo
       or p.id = auth.uid()
       or exists (
         select 1
         from public.track_members a
         join public.track_members b on a.track_id = b.track_id
         where a.user_id = auth.uid() and b.user_id = p.id and b.share_rule <> 'hidden'
       )
  ),
  buckets as (
    select c.category,
           case when c.category in (1, 2) then 'productive'
                when c.category in (6, 9) then 'brainrot'
                else 'other' end as bucket
    from (select generate_series(0, 9) as category) c
  )
  select v.id, v.name, v.is_demo, e.date,
         sum(case when b.bucket = 'productive' then 0.25 else 0 end),
         sum(case when b.bucket = 'brainrot' then 0.25 else 0 end)
  from visible v
  join public.day_entries e on e.user_id = v.id
  join buckets b on b.category = e.category
  group by v.id, v.name, v.is_demo, e.date;
end $$;
