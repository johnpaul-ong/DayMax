"use client";

/**
 * Friend directory: search other profiles, send/accept/remove
 * friendships, own @username and discoverable flag.
 *
 * Extracted from friends.ts. friends.ts re-exports for back-compat.
 */

import { createClient } from "@/lib/supabase/client";

async function uid(): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

export interface FoundProfile {
  memberId: string;
  displayName: string;
  username: string;
}

export async function searchProfiles(q: string): Promise<FoundProfile[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("search_profiles", { q });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ memberId: r.member_id, displayName: r.display_name, username: r.username }));
}

export interface Friendship {
  friendshipId: number;
  memberId: string;
  displayName: string;
  username: string;
  status: "pending" | "accepted";
  direction: "incoming" | "outgoing";
}

export async function listFriends(): Promise<Friendship[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_friends");
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    friendshipId: r.friendship_id,
    memberId: r.member_id,
    displayName: r.display_name,
    username: r.username,
    status: r.status,
    direction: r.direction,
  }));
}

export async function sendFriendRequest(memberId: string): Promise<void> {
  const supabase = createClient();
  const requester = await uid();
  const { error } = await supabase.from("friendships").insert({ requester, addressee: memberId });
  if (error) throw error;
}

export async function acceptFriendRequest(friendshipId: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("friendships").update({ status: "accepted" }).eq("id", friendshipId);
  if (error) throw error;
}

export async function removeFriendship(friendshipId: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("friendships").delete().eq("id", friendshipId);
  if (error) throw error;
}

export interface MyHandle {
  username: string | null;
  chosen: boolean;
}

/** Your own handle, and whether you've actually picked it yet. */
export async function fetchMyUsername(): Promise<MyHandle> {
  const supabase = createClient();
  const user_id = await uid();
  const { data, error } = await supabase
    .from("profiles")
    .select("username, username_chosen")
    .eq("id", user_id)
    .single();
  if (error) throw error;
  return { username: data?.username ?? null, chosen: !!data?.username_chosen };
}

export async function isUsernameAvailable(u: string): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("username_available", { u });
  if (error) throw error;
  return !!data;
}

export async function setUsername(u: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("set_username", { u });
  if (error) throw error;
}

export async function fetchDiscoverable(): Promise<boolean> {
  const supabase = createClient();
  const user_id = await uid();
  const { data, error } = await supabase.from("profiles").select("discoverable").eq("id", user_id).single();
  if (error) throw error;
  return !!data?.discoverable;
}

export async function setDiscoverable(v: boolean): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase.from("profiles").update({ discoverable: v }).eq("id", user_id);
  if (error) throw error;
}
