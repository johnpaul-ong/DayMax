"use client";

/**
 * Teams: Light, Dark and Cottage. Your team is your theme — picking a look at
 * signup enlists you, so there's no extra decision and the association is
 * immediate. Every pursuit gets a team scoreboard alongside the personal one.
 */

import { createClient } from "@/lib/supabase/client";
import type { ThemeName } from "@/lib/theme";

export type Team = ThemeName;

export const TEAMS: Array<{ key: Team; label: string; icon: string; color: string }> = [
  { key: "light", label: "Light", icon: "☀️", color: "#f59e0b" },
  { key: "dark", label: "Midnight", icon: "🌙", color: "#6366f1" },
  { key: "cottage", label: "Cottage", icon: "🍃", color: "#16a34a" },
];

export function teamMeta(key: string) {
  return TEAMS.find((t) => t.key === key) ?? { key: key as Team, label: key, icon: "•", color: "#94a3b8" };
}

/**
 * A name with its team colour on it. Deliberately understated — a 2px left
 * border and a faint tint, not a coloured pill. You should be able to read a
 * leaderboard without the teams shouting over the numbers.
 */
export function teamTint(team: string): { borderLeft: string; background: string } {
  const c = teamMeta(team).color;
  return { borderLeft: `2px solid ${c}`, background: `${c}14` };  // 14 = ~8% alpha
}

export interface TeamStanding {
  team: Team;
  members: number;
  /** Meaning depends on the pursuit: WorkMax/member, avg best lift, avg stat. */
  score: number;
  detail: string;
}

export async function fetchPursuitTeams(pursuitId: string, from?: string, to?: string): Promise<TeamStanding[]> {
  const supabase = createClient();
  const params: Record<string, unknown> = { p: pursuitId };
  if (from) params.from_date = from;
  if (to) params.to_date = to;
  const { data, error } = await supabase.rpc("pursuit_team_standings", params);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    team: r.team,
    members: Number(r.members),
    score: Number(r.score),
    detail: r.detail,
  }));
}

export interface TeamTotal {
  team: Team;
  members: number;
  workMax: number;
  productive: number;
  brainrot: number;
}

export async function fetchTeamTotals(
  from?: string,
  to?: string,
  scope: "demo" | "friends" | "everyone" | "track" = "everyone",
  trackId?: string | null
): Promise<TeamTotal[]> {
  const supabase = createClient();
  const params: Record<string, unknown> = { scope };
  if (trackId) params.t = trackId;
  if (from) params.from_date = from;
  if (to) params.to_date = to;
  const { data, error } = await supabase.rpc("team_totals", params);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    team: r.team,
    members: Number(r.members),
    workMax: Number(r.work_max),
    productive: Number(r.productive),
    brainrot: Number(r.brainrot),
  }));
}
