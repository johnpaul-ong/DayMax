"use client";

/**
 * Data layer for Phase 2+3: tracks, members, share rules, invites, Compare.
 * All Compare data flows through SQL functions that enforce share rules —
 * never query another user's tables directly (RLS would block it anyway).
 */

import { createClient } from "@/lib/supabase/client";

export type TrackKind = "day" | "lifts";
export type ShareRule = "hidden" | "totals_only" | "raw_labels";

export interface Track {
  id: string;
  ownerId: string;
  kind: TrackKind;
  name: string;
  isDemo: boolean;
}

export interface TrackMember {
  userId: string;
  role: "owner" | "member";
  shareRule: ShareRule;
  displayName: string;
}

export interface Invite {
  id: string;
  token: string;
  email: string | null;
  expiresAt: string;
  acceptedAt: string | null;
}

export interface CompareDayRow {
  memberId: string;
  displayName: string;
  date: string;
  productive: number;
  brainrot: number;
  other: number;
}

export interface CompareLiftRow {
  memberId: string;
  displayName: string;
  date: string;
  exercise: string;
  weightKg: number | null;
  reps: string | null;
}

async function uid(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

/**
 * Supabase caps RPC results at 1000 rows just like table queries —
 * a year of 15-minute slots is ~35k rows per person, so ALWAYS page.
 */
async function rpcAll(fn: string, params: Record<string, unknown> = {}): Promise<any[]> {
  const supabase = createClient();
  const all: any[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase.rpc(fn, params).range(from, from + page - 1);
    if (error) throw error;
    if (!data || (data as any[]).length === 0) break;
    all.push(...(data as any[]));
    if ((data as any[]).length < page) break;
  }
  return all;
}

export async function fetchTracks(): Promise<Track[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("tracks").select("id, owner_id, kind, name, is_demo").order("created_at");
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, ownerId: r.owner_id, kind: r.kind, name: r.name, isDemo: !!r.is_demo }));
}

export async function createTrack(name: string, kind: TrackKind): Promise<void> {
  const supabase = createClient();
  const owner_id = await uid();
  const { error } = await supabase.from("tracks").insert({ name, kind, owner_id });
  if (error) throw error;
}

export async function deleteTrack(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("tracks").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchMembers(trackId: string): Promise<TrackMember[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("track_member_list", { t: trackId });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    userId: r.member_id,
    role: r.role,
    shareRule: r.share_rule,
    displayName: r.display_name ?? "anonymous",
  }));
}

export async function setMyShareRule(trackId: string, rule: ShareRule): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase
    .from("track_members")
    .update({ share_rule: rule })
    .eq("track_id", trackId)
    .eq("user_id", user_id);
  if (error) throw error;
}

export async function removeMember(trackId: string, userId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("track_members").delete().eq("track_id", trackId).eq("user_id", userId);
  if (error) throw error;
}

export async function createInvite(trackId: string, email: string | null): Promise<Invite> {
  const supabase = createClient();
  const created_by = await uid();
  const { data, error } = await supabase
    .from("invites")
    .insert({ track_id: trackId, email: email || null, created_by })
    .select("id, token, email, expires_at, accepted_at")
    .single();
  if (error) throw error;
  return { id: data.id, token: data.token, email: data.email, expiresAt: data.expires_at, acceptedAt: data.accepted_at };
}

export async function fetchInvites(trackId: string): Promise<Invite[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("invites")
    .select("id, token, email, expires_at, accepted_at")
    .eq("track_id", trackId)
    .order("expires_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, token: r.token, email: r.email, expiresAt: r.expires_at, acceptedAt: r.accepted_at }));
}

export async function deleteInvite(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("invites").delete().eq("id", id);
  if (error) throw error;
}

export interface InviteInfo {
  trackName: string | null;
  trackKind: string | null;
  ownerName: string | null;
  valid: boolean;
  reason: string | null;
}

export async function getInviteInfo(token: string): Promise<InviteInfo> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_invite_info", { invite_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    trackName: row?.track_name ?? null,
    trackKind: row?.track_kind ?? null,
    ownerName: row?.owner_name ?? null,
    valid: !!row?.valid,
    reason: row?.reason ?? null,
  };
}

export async function acceptInvite(token: string, guardianAcknowledged: boolean): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("accept_invite", {
    invite_token: token,
    guardian_acknowledged: guardianAcknowledged,
  });
  if (error) throw error;
  return data as string;
}

// --- friend profiles -------------------------------------------------------

export type ProfileSection = "ranking" | "hours" | "lifts";
export const PROFILE_SECTIONS: Array<{ key: ProfileSection; label: string }> = [
  { key: "ranking", label: "Productivity ranking" },
  { key: "hours", label: "Hours per day/week/month" },
  { key: "lifts", label: "Lifts" },
];

export async function fetchMemberProfile(
  userId: string
): Promise<{ displayName: string; username: string | null; sections: ProfileSection[] }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("member_profile", { member: userId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const sections: ProfileSection[] = Array.isArray(row?.sections)
    ? (row.sections as ProfileSection[])
    : ["ranking", "hours", "lifts"];
  return { displayName: row?.display_name ?? "anonymous", username: row?.username ?? null, sections };
}

export async function fetchMyProfileSections(): Promise<ProfileSection[]> {
  const supabase = createClient();
  const user_id = await uid();
  const { data, error } = await supabase.from("profiles").select("profile_sections").eq("id", user_id).single();
  if (error) throw error;
  return Array.isArray(data?.profile_sections) ? data.profile_sections : ["ranking", "hours", "lifts"];
}

export async function saveMyProfileSections(sections: ProfileSection[]): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase.from("profiles").update({ profile_sections: sections }).eq("id", user_id);
  if (error) throw error;
}

export async function fetchCompareDay(trackId: string): Promise<CompareDayRow[]> {
  const data = await rpcAll("compare_day_totals", { t: trackId });
  return data.map((r: any) => ({
    memberId: r.member_id,
    displayName: r.display_name,
    date: String(r.date),
    productive: Number(r.productive),
    brainrot: Number(r.brainrot),
    other: Number(r.other),
  }));
}

// --- Arena --------------------------------------------------------------------

export interface LeaderboardRow {
  memberId: string;
  displayName: string;
  isDemo: boolean;
  date: string;
  productive: number;
  brainrot: number;
  social: number;
  other: number;
}

export async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  const data = await rpcAll("leaderboard_day_totals");
  return data.map((r: any) => ({
    memberId: r.member_id,
    displayName: r.display_name,
    isDemo: !!r.is_demo,
    date: String(r.date),
    productive: Number(r.productive),
    brainrot: Number(r.brainrot),
    social: Number(r.social ?? 0),
    other: Number(r.other ?? 0),
  }));
}

export interface DayStripRow {
  date: string;
  slot: number;
  category: number;
  label: string | null;
}

/**
 * 15-min history for a profile (demo users, yourself, or raw_labels friends).
 * Pass from/to to limit to a window — e.g. Side by side only needs a few
 * weeks around the selected date, not someone's whole year. Omit both for
 * the full history (what the profile page's year views need).
 */
export async function fetchMemberDayStrip(userId: string, from?: string, to?: string): Promise<DayStripRow[]> {
  const params: Record<string, unknown> = { member: userId };
  if (from) params.from_date = from;
  if (to) params.to_date = to;
  const data = await rpcAll("member_day_strip", params);
  return data.map((r: any) => ({
    date: String(r.date),
    slot: r.slot,
    category: r.category,
    label: r.label,
  }));
}

export async function fetchCompareLifts(trackId: string): Promise<CompareLiftRow[]> {
  const data = await rpcAll("compare_lifts", { t: trackId });
  return data.map((r: any) => ({
    memberId: r.member_id,
    displayName: r.display_name,
    date: String(r.date),
    exercise: r.exercise,
    weightKg: r.weight_kg,
    reps: r.reps,
  }));
}

// --- profile metrics + arena lifts ------------------------------------------

export interface MemberDayMetricsRow {
  date: string;
  emotionalScore: number | null;
  tired: number | null;
  startFriction: number | null;
  endBrainFatigue: number | null;
  weightKg: number | null;
}

export async function fetchMemberDayMetrics(userId: string): Promise<MemberDayMetricsRow[]> {
  const data = await rpcAll("member_day_metrics", { member: userId });
  return data.map((r: any) => ({
    date: String(r.date),
    emotionalScore: r.emotional_score,
    tired: r.tired,
    startFriction: r.start_friction,
    endBrainFatigue: r.end_brain_fatigue,
    weightKg: r.weight_kg,
  }));
}

export interface LeaderboardLiftRow {
  memberId: string;
  displayName: string;
  date: string;
  exercise: string;
  weightKg: number;
}

export async function fetchLeaderboardLifts(): Promise<LeaderboardLiftRow[]> {
  const data = await rpcAll("leaderboard_lifts");
  return data.map((r: any) => ({
    memberId: r.member_id,
    displayName: r.display_name,
    date: String(r.date),
    exercise: r.exercise,
    weightKg: Number(r.weight_kg),
  }));
}

// --- friend search & requests -------------------------------------------------

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

export async function addTrackMember(trackId: string, memberId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("add_track_member", { t: trackId, member: memberId });
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
