"use client";

/**
 * Arena / community boards: everyone's day totals and lifts, grouped
 * by scope (demo / friends / everyone / one track) or per-pursuit.
 * All reads go through the shared cachedRpcAll so hopping between
 * pages doesn't re-run the same 200k-row aggregate.
 *
 * Extracted from friends.ts. friends.ts re-exports for back-compat.
 */

import { cachedRpcAll, invalidateCommunityCache } from "./supabase/cachedRpcAll";

export { invalidateCommunityCache };

export interface LeaderboardRow {
  memberId: string;
  displayName: string;
  isDemo: boolean;
  team: string;
  date: string;
  productive: number;
  brainrot: number;
  social: number;
  other: number;
}

export type ArenaScope = "demo" | "friends" | "everyone" | "track";

/**
 * Arena rows for one scope. Unlike fetchLeaderboard, the scopes here mean
 * exactly what they say: "friends" is accepted friendships only (no legends,
 * no track-mates you never friended), and "everyone" is every public profile.
 */
export async function fetchArena(
  scope: ArenaScope,
  trackId?: string | null,
  from?: string,
  to?: string
): Promise<LeaderboardRow[]> {
  const params: Record<string, unknown> = { scope };
  if (trackId) params.t = trackId;
  if (from) params.from_date = from;
  if (to) params.to_date = to;
  const data = await cachedRpcAll("arena_day_totals", params);
  return data.map((r: any) => ({
    memberId: r.member_id,
    displayName: r.display_name,
    isDemo: !!r.is_demo,
    team: r.team ?? "light",
    date: String(r.date),
    productive: Number(r.productive),
    brainrot: Number(r.brainrot),
    social: Number(r.social ?? 0),
    other: Number(r.other ?? 0),
  }));
}

/**
 * Everyone's daily bucket totals. Pass a window when you only need one —
 * the Arena's all-time boards need everything, but a week view does not.
 */
export async function fetchLeaderboard(from?: string, to?: string): Promise<LeaderboardRow[]> {
  const params: Record<string, unknown> = {};
  if (from) params.from_date = from;
  if (to) params.to_date = to;
  const data = await cachedRpcAll("leaderboard_day_totals", params);
  return data.map((r: any) => ({
    memberId: r.member_id,
    displayName: r.display_name,
    isDemo: !!r.is_demo,
    team: r.team ?? "light",
    date: String(r.date),
    productive: Number(r.productive),
    brainrot: Number(r.brainrot),
    social: Number(r.social ?? 0),
    other: Number(r.other ?? 0),
  }));
}

/** Day totals for the members of one pursuit — what a Life-style board reads. */
export async function fetchPursuitDayTotals(pursuitId: string, from?: string, to?: string): Promise<LeaderboardRow[]> {
  const params: Record<string, unknown> = { p: pursuitId };
  if (from) params.from_date = from;
  if (to) params.to_date = to;
  const data = await cachedRpcAll("pursuit_day_totals", params);
  return data.map((r: any) => ({
    memberId: r.member_id,
    displayName: r.display_name,
    isDemo: !!r.is_demo,
    team: r.team ?? "light",
    date: String(r.date),
    productive: Number(r.productive),
    brainrot: Number(r.brainrot),
    social: Number(r.social ?? 0),
    other: Number(r.other ?? 0),
  }));
}

export async function fetchPursuitLifts(pursuitId: string, from?: string): Promise<LeaderboardLiftRow[]> {
  const params: Record<string, unknown> = { p: pursuitId };
  if (from) params.from_date = from;
  const data = await cachedRpcAll("pursuit_lift_rows", params);
  return data.map((r: any) => ({
    memberId: r.member_id,
    displayName: r.display_name,
    date: String(r.date),
    exercise: r.exercise,
    weightKg: Number(r.weight_kg),
  }));
}

export interface LeaderboardLiftRow {
  memberId: string;
  displayName: string;
  date: string;
  exercise: string;
  weightKg: number;
}

export async function fetchLeaderboardLifts(from?: string, to?: string): Promise<LeaderboardLiftRow[]> {
  const params: Record<string, unknown> = {};
  if (from) params.from_date = from;
  if (to) params.to_date = to;
  const data = await cachedRpcAll("leaderboard_lifts", params);
  return data.map((r: any) => ({
    memberId: r.member_id,
    displayName: r.display_name,
    date: String(r.date),
    exercise: r.exercise,
    weightKg: Number(r.weight_kg),
  }));
}
