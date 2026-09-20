/**
 * Notifications — one inbox per person, driven by migration 0040.
 *
 * Everything here calls the SECURITY DEFINER RPCs in that migration:
 *
 *   my_notifications(limit)            -> list
 *   unread_notification_count()        -> badge number
 *   mark_notification_read(id)         -> mark one
 *   mark_all_notifications_read()      -> mark everything
 *   invite_to_challenge(chId, userId)  -> create an invite ping
 *
 * The client also opens a realtime subscription to public.notifications
 * so the badge updates the moment a new row arrives. See
 * `subscribeToNotifications` below.
 */

import { createClient } from "./supabase/client";

export type NotificationKind =
  | "friend_request"
  | "friend_accepted"
  | "challenge_invite"
  | "comment_reply"
  | "comment_like"
  | "summary_ready"
  | "challenge_ended";

export interface Notification {
  id: string;
  kind: NotificationKind | string;
  title: string;
  body: string | null;
  link: string | null;
  meta: Record<string, unknown>;
  actorId: string | null;
  actorName: string | null;
  actorUsername: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Fetch the last N notifications for the signed-in user. */
export async function fetchNotifications(limit = 50): Promise<Notification[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("my_notifications", { limit_n: limit });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    link: r.link,
    meta: r.meta ?? {},
    actorId: r.actor_id,
    actorName: r.actor_name,
    actorUsername: r.actor_username,
    readAt: r.read_at,
    createdAt: r.created_at,
  }));
}

/** The badge number. Fast (indexed partial). */
export async function fetchUnreadCount(): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("unread_notification_count");
  if (error) throw error;
  return Number(data ?? 0);
}

export async function markRead(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
  if (error) throw error;
}

export async function markAllRead(): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("mark_all_notifications_read");
  if (error) throw error;
  return Number(data ?? 0);
}

/**
 * Invite `userId` to a challenge. Emits a notification for them; the
 * invitee accepts by opening the link and joining. Server refuses if
 * the caller isn't a member of the challenge, if the invitee is you,
 * or if an unread invite for that challenge already exists.
 */
export async function inviteToChallenge(challengeId: string, userId: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("invite_to_challenge", {
    p_challenge: challengeId,
    p_user: userId,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/**
 * Realtime subscription. Fires `onChange` for INSERT / UPDATE / DELETE on
 * public.notifications for the signed-in user. Returns an unsubscribe
 * function; call it in the effect cleanup.
 *
 * We deliberately fire a SIMPLE callback rather than delivering the
 * payload -- the caller almost always refetches to pick up server-side
 * derived joins (actor name/username), and a bulk refetch is cheaper
 * than a per-row merge when three notifications land in the same tick.
 */
export function subscribeToNotifications(userId: string, onChange: () => void): () => void {
  const supabase = createClient();
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      "postgres_changes" as any,
      { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      () => onChange(),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
