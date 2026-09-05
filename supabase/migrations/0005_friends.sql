-- DayMax migration 5: Phase 2+3 — tracks, members, share rules, invites, Compare.
-- Compare is enforced HERE, in SQL, not in app code: security-definer functions
-- return only what each member's share rule allows. Paste into the SQL Editor and Run.

-- helpers ---------------------------------------------------------------------

create function public.is_minor(u uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(
    (select birth_date > (current_date - interval '18 years') from public.profiles where id = u),
    false
  );
$$;

-- tracks ----------------------------------------------------------------------

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('day', 'lifts')),
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.tracks enable row level security;

create table public.track_members (
  track_id uuid not null references public.tracks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  share_rule text not null default 'totals_only' check (share_rule in ('hidden', 'totals_only', 'raw_labels')),
  guardian_ack boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (track_id, user_id)
);
alter table public.track_members enable row level security;

create function public.is_track_member(t uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.track_members m where m.track_id = t and m.user_id = auth.uid());
$$;

create policy "member or owner reads track" on public.tracks
  for select using (owner_id = auth.uid() or public.is_track_member(id));
create policy "owner creates track" on public.tracks
  for insert with check (owner_id = auth.uid());
create policy "owner updates track" on public.tracks
  for update using (owner_id = auth.uid());
create policy "owner deletes track" on public.tracks
  for delete using (owner_id = auth.uid());

-- owner membership is created automatically
create function public.handle_new_track()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.track_members (track_id, user_id, role, share_rule)
  values (new.id, new.owner_id, 'owner', 'totals_only');
  return new;
end $$;
create trigger on_track_created after insert on public.tracks
  for each row execute function public.handle_new_track();

create policy "members see the member list" on public.track_members
  for select using (public.is_track_member(track_id));
-- minors cannot switch to raw_labels without guardian acknowledgment
create policy "edit own share rule" on public.track_members
  for update using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (share_rule <> 'raw_labels' or not public.is_minor(auth.uid()) or guardian_ack)
  );
create policy "leave, or owner removes" on public.track_members
  for delete using (
    user_id = auth.uid()
    or exists (select 1 from public.tracks t where t.id = track_id and t.owner_id = auth.uid())
  );
-- no insert policy: memberships are only created by the trigger and accept_invite()

-- invites (shareable links) -----------------------------------------------------

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks (id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  email text, -- optional: restrict who may accept
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_by uuid references auth.users (id),
  accepted_at timestamptz
);
alter table public.invites enable row level security;
create policy "owner manages invites" on public.invites
  for all using (exists (select 1 from public.tracks t where t.id = track_id and t.owner_id = auth.uid()))
  with check (exists (select 1 from public.tracks t where t.id = track_id and t.owner_id = auth.uid()));

-- invitee looks up an invite by token (returns nothing sensitive)
create function public.get_invite_info(invite_token uuid)
returns table (track_name text, track_kind text, owner_name text, valid boolean, reason text)
language plpgsql security definer stable set search_path = public as $$
declare inv record;
begin
  select i.*, t.name as tname, t.kind as tkind, p.display_name as oname
    into inv
    from public.invites i
    join public.tracks t on t.id = i.track_id
    left join public.profiles p on p.id = t.owner_id
    where i.token = invite_token;
  if not found then
    return query select null::text, null::text, null::text, false, 'Invite not found';
  elsif inv.accepted_at is not null then
    return query select inv.tname, inv.tkind, inv.oname, false, 'Invite already used';
  elsif inv.expires_at < now() then
    return query select inv.tname, inv.tkind, inv.oname, false, 'Invite expired';
  elsif inv.email is not null and lower(inv.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    return query select inv.tname, inv.tkind, inv.oname, false, 'This invite is for a different email address';
  else
    return query select inv.tname, inv.tkind, inv.oname, true, null::text;
  end if;
end $$;

create function public.accept_invite(invite_token uuid, guardian_acknowledged boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into inv from public.invites where token = invite_token;
  if not found then raise exception 'Invite not found'; end if;
  if inv.accepted_at is not null then raise exception 'Invite already used'; end if;
  if inv.expires_at < now() then raise exception 'Invite expired'; end if;
  if inv.email is not null and lower(inv.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'This invite is for a different email address';
  end if;
  if public.is_minor(auth.uid()) and not guardian_acknowledged then
    raise exception 'Under-18 accounts need guardian acknowledgment to join';
  end if;
  insert into public.track_members (track_id, user_id, role, share_rule, guardian_ack)
  values (inv.track_id, auth.uid(), 'member', 'totals_only', guardian_acknowledged)
  on conflict (track_id, user_id) do nothing;
  update public.invites set accepted_by = auth.uid(), accepted_at = now() where id = inv.id;
  return inv.track_id;
end $$;

-- member list with display names (profiles RLS only exposes your own row,
-- so names for the member list come through this checked function)
create function public.track_member_list(t uuid)
returns table (member_id uuid, role text, share_rule text, display_name text)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_track_member(t) then raise exception 'Not a member of this track'; end if;
  return query
  select m.user_id, m.role, m.share_rule, coalesce(p.display_name, 'anonymous')
  from public.track_members m
  left join public.profiles p on p.id = m.user_id
  where m.track_id = t
  order by m.joined_at;
end $$;

-- Compare: the ONLY way members see each other's numbers ------------------------
-- Buckets come from the track owner's settings so the ranking is fair for the group.

create function public.compare_day_totals(t uuid)
returns table (member_id uuid, display_name text, date date, productive numeric, brainrot numeric, other numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_track_member(t) then raise exception 'Not a member of this track'; end if;
  return query
  with owner_buckets as (
    select bs.category, bs.bucket
    from public.bucket_settings bs
    join public.tracks tr on tr.owner_id = bs.user_id
    where tr.id = t
  ),
  buckets as (
    select c.category,
           coalesce(ob.bucket,
             case when c.category in (1, 2) then 'productive'
                  when c.category in (6, 9) then 'brainrot'
                  else 'other' end) as bucket
    from (select generate_series(0, 9) as category) c
    left join owner_buckets ob on ob.category = c.category
  )
  select m.user_id,
         coalesce(p.display_name, 'anonymous'),
         e.date,
         sum(case when b.bucket = 'productive' then 0.25 else 0 end),
         sum(case when b.bucket = 'brainrot' then 0.25 else 0 end),
         sum(case when b.bucket = 'other' then 0.25 else 0 end)
  from public.track_members m
  join public.day_entries e on e.user_id = m.user_id
  join buckets b on b.category = e.category
  left join public.profiles p on p.id = m.user_id
  where m.track_id = t and m.share_rule <> 'hidden'
  group by m.user_id, p.display_name, e.date;
end $$;

create function public.compare_lifts(t uuid)
returns table (member_id uuid, display_name text, date date, exercise text, weight_kg numeric, reps text)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_track_member(t) then raise exception 'Not a member of this track'; end if;
  return query
  select m.user_id, coalesce(p.display_name, 'anonymous'), l.date, l.exercise, l.weight_kg, l.reps
  from public.track_members m
  join public.lift_entries l on l.user_id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.track_id = t and m.share_rule <> 'hidden';
  -- notes are never shared
end $$;

-- raw day detail: only for members who explicitly chose raw_labels
create function public.compare_raw_day(t uuid, member uuid, day date)
returns table (slot smallint, category smallint, label text)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_track_member(t) then raise exception 'Not a member of this track'; end if;
  if not exists (
    select 1 from public.track_members m
    where m.track_id = t and m.user_id = member and m.share_rule = 'raw_labels'
  ) then
    raise exception 'This member does not share raw labels';
  end if;
  return query
  select e.slot, e.category, e.label from public.day_entries e
  where e.user_id = member and e.date = day
  order by e.slot;
end $$;
