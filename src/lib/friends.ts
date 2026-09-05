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

export async function fetchMemberProfile(userId: string): Promise<{ displayName: string; sections: ProfileSection[] }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("member_profile", { member: userId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const sections = Array.isArray(row?.sections) ? (row.sections as ProfileSection[]) : ["ranking", "hours", "lifts"];
  return { displayName: row?.display_name ?? "anonymous", sections };
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
  const supabase = createClient();
  const { data, error } = await supabase.rpc("compare_day_totals", { t: trackId });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
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
}

export async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("leaderboard_day_totals");
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    memberId: r.member_id,
    displayName: r.display_name,
    isDemo: !!r.is_demo,
    date: String(r.date),
    productive: Number(r.productive),
    brainrot: Number(r.brainrot),
    social: Number(r.social ?? 0),
  }));
}

export interface DayStripRow {
  date: string;
  slot: number;
  category: number;
  label: string | null;
}

/** Full 15-min history for a profile (demo users, yourself, or raw_labels friends). */
export async function fetchMemberDayStrip(userId: string): Promise<DayStripRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("member_day_strip", { member: userId });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    date: String(r.date),
    slot: r.slot,
    category: r.category,
    label: r.label,
  }));
}

export async function fetchCompareLifts(trackId: string): Promise<CompareLiftRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("compare_lifts", { t: trackId });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    memberId: r.member_id,
    displayName: r.display_name,
    date: String(r.date),
    exercise: r.exercise,
    weightKg: r.weight_kg,
    reps: r.reps,
  }));
}
