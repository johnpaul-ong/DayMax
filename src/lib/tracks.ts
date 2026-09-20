"use client";

/**
 * Tracks: named groups of members with a share rule per person that
 * decides what their data looks like from the outside (hidden / totals
 * only / raw labels). The Compare screens read exclusively through
 * these — the raw tables are RLS-locked.
 *
 * Extracted from friends.ts. friends.ts re-exports for back-compat.
 */

import { createClient } from "@/lib/supabase/client";
import { rpcAll } from "./supabase/rpcAll";

export type TrackKind = "day" | "lifts";
export type ShareRule = "hidden" | "totals_only" | "raw_labels";

export interface Track {
  id: string;
  ownerId: string;
  kind: TrackKind;
  name: string;
  isDemo: boolean;
  boardEnabled: boolean;
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
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

export async function fetchTracks(): Promise<Track[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tracks")
    .select("id, owner_id, kind, name, is_demo, board_enabled")
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    ownerId: r.owner_id,
    kind: r.kind,
    name: r.name,
    isDemo: !!r.is_demo,
    boardEnabled: r.board_enabled ?? true,
  }));
}

export async function createTrack(name: string, kind: TrackKind): Promise<void> {
  const supabase = createClient();
  const owner_id = await uid();
  const { error } = await supabase.from("tracks").insert({ name, kind, owner_id });
  if (error) throw error;
}

export async function renameTrack(id: string, name: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("tracks").update({ name }).eq("id", id);
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

export async function addTrackMember(trackId: string, memberId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("add_track_member", { t: trackId, member: memberId });
  if (error) throw error;
}
