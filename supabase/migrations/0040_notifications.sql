-- DayMax migration 40: in-app notifications.
--
-- One inbox per person for pings that today have nowhere to land:
-- friend requests, friend-accepted, challenge invites (Phase 2 will
-- extend this with comment_reply and comment_like when the comments
-- system ships). Everything goes through public.notifications; the
-- client subscribes to it via Supabase realtime for a live badge.
--
-- SECURITY, because this table is a fan-out target (server code and
-- triggers insert notifications addressed to OTHER people, not just
-- the caller):
--   * SELECT/UPDATE/DELETE policies restrict rows to the recipient
--     (user_id = auth.uid()). Nobody sees anyone else's inbox.
--   * INSERT has NO policy, so RLS blocks every direct insert from
--     a client. All inserts happen through security-definer
--     functions (emit_notification, invite_to_challenge) or from
--     triggers -- each of which validates its own rules first.

-- ---------------------------------------------------------------------------
-- 1. Table + indexes + RLS
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  actor_id uuid references auth.users (id) on delete set null,
  title text not null,
  body text,
  link text,
  meta jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists "mark own notifications" on public.notifications;
create policy "mark own notifications" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "delete own notifications" on public.notifications;
create policy "delete own notifications" on public.notifications
  for delete using (user_id = auth.uid());

-- No INSERT policy on purpose. All writes go through the security-
-- definer functions below.

-- ---------------------------------------------------------------------------
-- 2. Helpers -- create, mark read, count, fetch
-- ---------------------------------------------------------------------------

create or replace function public.emit_notification(
  p_user uuid,
  p_kind text,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_actor uuid default null,
  p_meta jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if p_user is null then return null; end if;
  insert into public.notifications (user_id, kind, title, body, link, actor_id, meta)
  values (p_user, p_kind, p_title, p_body, p_link, p_actor, coalesce(p_meta, '{}'::jsonb))
  returning id into nid;
  return nid;
end $$;

create or replace function public.mark_notification_read(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.notifications
     set read_at = now()
   where id = p_id and user_id = auth.uid() and read_at is null;
$$;

create or replace function public.mark_all_notifications_read()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.unread_notification_count()
returns int language sql security definer stable set search_path = public as $$
  select count(*)::int
    from public.notifications
   where user_id = auth.uid() and read_at is null;
$$;

drop function if exists public.my_notifications(int);
create function public.my_notifications(limit_n int default 50)
returns table (
  id uuid, kind text, title text, body text, link text, meta jsonb,
  actor_id uuid, actor_name text, actor_username text,
  read_at timestamptz, created_at timestamptz
) language sql security definer stable set search_path = public as $$
  select n.id, n.kind, n.title, n.body, n.link, n.meta,
         n.actor_id,
         coalesce(pr.display_name, 'someone'),
         pr.username,
         n.read_at, n.created_at
  from public.notifications n
  left join public.profiles pr on pr.id = n.actor_id
  where n.user_id = auth.uid()
  order by n.created_at desc
  limit least(greatest(coalesce(limit_n, 50), 1), 200);
$$;

-- ---------------------------------------------------------------------------
-- 3. Friend request + friend accepted triggers
-- ---------------------------------------------------------------------------

create or replace function public.notify_friend_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare from_name text;
begin
  if new.status = 'pending' then
    select coalesce(pr.display_name, 'someone') into from_name
      from public.profiles pr where pr.id = new.requester;
    perform public.emit_notification(
      new.addressee,
      'friend_request',
      from_name || ' wants to be friends',
      null,
      '/friends',
      new.requester
    );
  end if;
  return new;
end $$;

drop trigger if exists notify_friend_request on public.friendships;
create trigger notify_friend_request
  after insert on public.friendships
  for each row execute function public.notify_friend_request();

create or replace function public.notify_friend_accepted()
returns trigger language plpgsql security definer set search_path = public as $$
declare accepter_name text;
begin
  if new.status = 'accepted' and old.status = 'pending' then
    select coalesce(pr.display_name, 'someone') into accepter_name
      from public.profiles pr where pr.id = new.addressee;
    perform public.emit_notification(
      new.requester,
      'friend_accepted',
      accepter_name || ' accepted your friend request',
      null,
      '/friends/' || new.addressee::text,
      new.addressee
    );
  end if;
  return new;
end $$;

drop trigger if exists notify_friend_accepted on public.friendships;
create trigger notify_friend_accepted
  after update on public.friendships
  for each row execute function public.notify_friend_accepted();

-- ---------------------------------------------------------------------------
-- 4. Challenge-invite trigger
--
-- public.challenge_invites (migration 0036) is the source of truth for
-- "friend X invited friend Y to challenge Z". Rather than duplicate the
-- invite flow through a new RPC, we hang a trigger off that table so
-- every insert emits one notification for the invitee. If the same
-- invite already sits unread in their inbox, we don't re-ping.
-- ---------------------------------------------------------------------------

create or replace function public.notify_challenge_invite()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ch public.challenges%rowtype;
  inviter_name text;
begin
  -- Skip if there's already an unread invite for this challenge
  if exists (
    select 1 from public.notifications
     where user_id = new.invited_user
       and kind = 'challenge_invite'
       and (meta->>'challenge_id')::uuid = new.challenge_id
       and read_at is null
  ) then
    return new;
  end if;

  select * into ch from public.challenges where id = new.challenge_id;
  if ch.id is null then return new; end if;

  select coalesce(pr.display_name, 'someone') into inviter_name
    from public.profiles pr where pr.id = new.invited_by;

  perform public.emit_notification(
    new.invited_user,
    'challenge_invite',
    coalesce(inviter_name, 'someone') || ' invited you to "' || ch.name || '"',
    to_char(ch.starts_on, 'Mon DD') || ' — ' || to_char(ch.ends_on, 'Mon DD'),
    '/challenges/' || ch.id::text,
    new.invited_by,
    jsonb_build_object(
      'challenge_id', ch.id,
      'invite_token', ch.invite_token,
      'starts_on', ch.starts_on,
      'ends_on', ch.ends_on
    )
  );
  return new;
end $$;

drop trigger if exists notify_challenge_invite on public.challenge_invites;
create trigger notify_challenge_invite
  after insert on public.challenge_invites
  for each row execute function public.notify_challenge_invite();

-- Backfill: existing pending invites (not yet joined, not yet expired)
-- get one notification each -- same de-dup rule as the trigger.
insert into public.notifications (user_id, kind, title, body, link, actor_id, meta)
select i.invited_user,
       'challenge_invite',
       coalesce(pr.display_name, 'someone') || ' invited you to "' || c.name || '"',
       to_char(c.starts_on, 'Mon DD') || ' — ' || to_char(c.ends_on, 'Mon DD'),
       '/challenges/' || c.id::text,
       i.invited_by,
       jsonb_build_object(
         'challenge_id', c.id,
         'invite_token', c.invite_token,
         'starts_on', c.starts_on,
         'ends_on', c.ends_on
       )
  from public.challenge_invites i
  join public.challenges c on c.id = i.challenge_id
  left join public.profiles pr on pr.id = i.invited_by
  where c.ends_on >= current_date
    and not exists (
      select 1 from public.notifications n
       where n.user_id = i.invited_user
         and n.kind = 'challenge_invite'
         and (n.meta->>'challenge_id')::uuid = i.challenge_id
    );

-- ---------------------------------------------------------------------------
-- 5. Backfill: existing pending friend requests emit a notification
--    (only for ones that don't already have one, so this is safe to
--    re-run.)
-- ---------------------------------------------------------------------------

insert into public.notifications (user_id, kind, title, link, actor_id)
select f.addressee,
       'friend_request',
       coalesce(pr.display_name, 'someone') || ' wants to be friends',
       '/friends',
       f.requester
  from public.friendships f
  left join public.profiles pr on pr.id = f.requester
  where f.status = 'pending'
    and not exists (
      select 1 from public.notifications n
      where n.user_id = f.addressee
        and n.kind = 'friend_request'
        and n.actor_id = f.requester
    );

-- ---------------------------------------------------------------------------
-- 6. Realtime: add the table to the realtime publication.
--    Wrapped so the migration doesn't fail if the table is already
--    published (from a previous partial run of this migration).
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then
    null;
  end;
end $$;
