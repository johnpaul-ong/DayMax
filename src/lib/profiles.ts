"use client";

/**
 * The public profile page reads from here: header (MemberProfile),
 * the visibility grid the owner controls, and the per-section readers
 * (bodyweight, exercises, day totals, lifts, metrics, day strip).
 *
 * Extracted from friends.ts. friends.ts re-exports for back-compat.
 */

import { createClient } from "@/lib/supabase/client";
import { rpcAll } from "./supabase/rpcAll";
import { cachedRpcAll } from "./supabase/cachedRpcAll";
import type { CompareLiftRow } from "./tracks";

async function uid(): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

export type ProfileSection = "ranking" | "hours" | "lifts" | "metrics" | "days";
export const PROFILE_SECTIONS: Array<{ key: ProfileSection; label: string; hint: string }> = [
  { key: "ranking", label: "Productivity ranking", hint: "WorkMax and focus score" },
  { key: "hours", label: "Hours per day/week/month", hint: "Productive / brainrot / other totals" },
  { key: "lifts", label: "Lifts", hint: "Exercises and weights over time" },
  { key: "metrics", label: "How you felt", hint: "Emotional score, tiredness, friction" },
  { key: "days", label: "Your days", hint: "The 15-minute grid and year heatmap — colours only, never your written labels" },
];

/** The default: a profile shows everything unless its owner trims it. */
export const ALL_SECTIONS: ProfileSection[] = ["ranking", "hours", "lifts", "metrics", "days"];

export type FriendStatus = "self" | "friends" | "pending_out" | "pending_in" | "none";

export interface MemberProfile {
  displayName: string;
  username: string | null;
  sections: ProfileSection[];
  isPublic: boolean;
  isSelf: boolean;
  friendStatus: FriendStatus;
  team: string;
  defaultExercise: string | null;
}

export async function fetchMemberProfile(userId: string): Promise<MemberProfile> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("member_profile", { member: userId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const sections: ProfileSection[] = Array.isArray(row?.sections)
    ? (row.sections as ProfileSection[])
    : ALL_SECTIONS;
  return {
    displayName: row?.display_name ?? "anonymous",
    username: row?.username ?? null,
    sections,
    isPublic: !!row?.is_public,
    isSelf: !!row?.is_self,
    friendStatus: (row?.friend_status ?? "none") as FriendStatus,
    team: row?.team ?? "light",
    defaultExercise: row?.default_exercise ?? null,
  };
}

/** Bodyweight over time — standard on every profile that shows Lifts. */
export async function fetchMemberBodyweight(userId: string): Promise<Array<{ date: string; weightKg: number }>> {
  const data = await cachedRpcAll("member_bodyweight", { member: userId });
  return data.map((r: any) => ({ date: String(r.date), weightKg: Number(r.weight_kg) }));
}

/** Which exercises someone logs, most-used first — powers the default picker. */
export async function fetchMemberExercises(userId: string): Promise<Array<{ exercise: string; sessions: number; best: number }>> {
  const data = await cachedRpcAll("member_exercises", { member: userId });
  return data.map((r: any) => ({ exercise: r.exercise, sessions: Number(r.sessions), best: Number(r.best) }));
}

export async function setDefaultExercise(exercise: string | null): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase.from("profiles").update({ default_exercise: exercise }).eq("id", user_id);
  if (error) throw error;
}

/** Day totals for a profile — gated on visibility, not on sharing a track. */
export interface MemberDayTotal {
  date: string;
  productive: number;
  brainrot: number;
  social: number;
  other: number;
}

export async function fetchMemberDayTotals(userId: string, from?: string, to?: string): Promise<MemberDayTotal[]> {
  const params: Record<string, unknown> = { member: userId };
  if (from) params.from_date = from;
  if (to) params.to_date = to;
  const data = await cachedRpcAll("member_day_totals", params);
  return data.map((r: any) => ({
    date: String(r.date),
    productive: Number(r.productive),
    brainrot: Number(r.brainrot),
    social: Number(r.social ?? 0),
    other: Number(r.other ?? 0),
  }));
}

export async function fetchMemberLifts(userId: string): Promise<CompareLiftRow[]> {
  const data = await cachedRpcAll("member_lifts", { member: userId });
  return data.map((r: any) => ({
    memberId: userId,
    displayName: "",
    date: String(r.date),
    exercise: r.exercise,
    weightKg: r.weight_kg,
    reps: r.reps,
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
  const data = await cachedRpcAll("member_day_strip", params);
  return data.map((r: any) => ({
    date: String(r.date),
    slot: r.slot,
    category: r.category,
    label: r.label,
  }));
}

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

// --- my own visibility settings ------------------------------------------------

export interface MyVisibility {
  isPublic: boolean;
  friendSections: ProfileSection[];
  publicSections: ProfileSection[];
}

export async function fetchMyVisibility(): Promise<MyVisibility> {
  const supabase = createClient();
  const user_id = await uid();
  const { data, error } = await supabase
    .from("profiles")
    .select("is_public, profile_sections, public_sections")
    .eq("id", user_id)
    .single();
  if (error) throw error;
  const fallback: ProfileSection[] = ALL_SECTIONS;
  return {
    isPublic: data?.is_public ?? true,
    friendSections: Array.isArray(data?.profile_sections) ? data.profile_sections : fallback,
    publicSections: Array.isArray(data?.public_sections) ? data.public_sections : fallback,
  };
}

export async function saveMyVisibility(v: Partial<MyVisibility>): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const row: Record<string, unknown> = {};
  if (v.isPublic !== undefined) row.is_public = v.isPublic;
  if (v.friendSections) row.profile_sections = v.friendSections;
  if (v.publicSections) row.public_sections = v.publicSections;
  const { error } = await supabase.from("profiles").update(row).eq("id", user_id);
  if (error) throw error;
}

export async function fetchMyProfileSections(): Promise<ProfileSection[]> {
  const supabase = createClient();
  const user_id = await uid();
  const { data, error } = await supabase.from("profiles").select("profile_sections").eq("id", user_id).single();
  if (error) throw error;
  return Array.isArray(data?.profile_sections) ? data.profile_sections : ALL_SECTIONS;
}

export async function saveMyProfileSections(sections: ProfileSection[]): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase.from("profiles").update({ profile_sections: sections }).eq("id", user_id);
  if (error) throw error;
}
