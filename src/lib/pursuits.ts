"use client";

/**
 * Pursuits data layer. Values are shared with fellow pursuit members through
 * pursuit_stat_data(); notes are private and only ever readable by their author.
 */

import { createClient } from "@/lib/supabase/client";

export interface Pursuit {
  id: string;
  name: string;
  description: string;
  kind: "life" | "lifts" | "custom";
  isPublic: boolean;
  ownerName: string;
  memberCount: number;
  isMember: boolean;
  isOwner: boolean;
}

export interface PursuitStat {
  id: string;
  pursuitId: string;
  name: string;
  unit: string;
  direction: "more" | "less";
  cadence: "daily" | "whenever";
  target: number | null;
  chart: "line" | "bar" | "pie";
  hidden: boolean;
}

export interface StatEntry {
  memberId: string;
  displayName: string;
  date: string;
  value: number;
}

export interface MyEntry {
  date: string;
  value: number;
  note: string | null;
}

async function uid(): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

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

export async function fetchDirectory(): Promise<Pursuit[]> {
  const data = await rpcAll("pursuit_directory");
  return data.map((r: any) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    kind: r.kind,
    isPublic: !!r.is_public,
    ownerName: r.owner_name,
    memberCount: Number(r.member_count),
    isMember: !!r.is_member,
    isOwner: !!r.is_owner,
  }));
}

export async function createPursuit(name: string, description: string, isPublic: boolean): Promise<void> {
  const supabase = createClient();
  const owner_id = await uid();
  const { error } = await supabase.from("pursuits").insert({ name, description, is_public: isPublic, owner_id });
  if (error) {
    if (String(error.message).includes("pursuits_public_name_idx"))
      throw new Error(`A public pursuit named "${name}" already exists — pick another name.`);
    throw error;
  }
}

export async function setPursuitPublic(id: string, isPublic: boolean): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("pursuits").update({ is_public: isPublic }).eq("id", id);
  if (error) {
    if (String(error.message).includes("pursuits_public_name_idx"))
      throw new Error("A public pursuit with this name already exists — rename yours first.");
    throw error;
  }
}

export async function deletePursuit(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("pursuits").delete().eq("id", id);
  if (error) throw error;
}

export async function joinPursuit(id: string): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase.from("pursuit_members").insert({ pursuit_id: id, user_id });
  if (error) throw error;
}

export async function leavePursuit(id: string): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase.from("pursuit_members").delete().eq("pursuit_id", id).eq("user_id", user_id);
  if (error) throw error;
}

export async function addPursuitMember(pursuitId: string, memberId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("add_pursuit_member", { p: pursuitId, member: memberId });
  if (error) throw error;
}

export async function setShowOnProfile(pursuitId: string, show: boolean): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase
    .from("pursuit_members")
    .update({ show_on_profile: show })
    .eq("pursuit_id", pursuitId)
    .eq("user_id", user_id);
  if (error) throw error;
}

export async function fetchStats(pursuitId: string): Promise<PursuitStat[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("pursuit_stats")
    .select("id, pursuit_id, name, unit, direction, cadence, target, chart, hidden")
    .eq("pursuit_id", pursuitId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    pursuitId: r.pursuit_id,
    name: r.name,
    unit: r.unit,
    direction: r.direction,
    cadence: r.cadence,
    target: r.target,
    chart: r.chart ?? "line",
    hidden: !!r.hidden,
  }));
}

export async function createStat(
  pursuitId: string,
  s: { name: string; unit: string; direction: "more" | "less"; cadence: "daily" | "whenever"; target: number | null }
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("pursuit_stats").insert({ pursuit_id: pursuitId, ...s });
  if (error) throw error;
}

export async function updatePursuitDescription(id: string, description: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("pursuits").update({ description }).eq("id", id);
  if (error) throw error;
}

export async function updateStat(id: string, patch: { chart?: "line" | "bar" | "pie"; hidden?: boolean; target?: number | null }): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("pursuit_stats").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteStat(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("pursuit_stats").delete().eq("id", id);
  if (error) throw error;
}

/** Everyone's values for a stat (no notes — those are private). */
export async function fetchStatData(statId: string): Promise<StatEntry[]> {
  const data = await rpcAll("pursuit_stat_data", { s: statId });
  return data.map((r: any) => ({
    memberId: r.member_id,
    displayName: r.display_name,
    date: String(r.date),
    value: Number(r.value),
  }));
}

/** My own entries including notes. */
export async function fetchMyEntries(statId: string): Promise<MyEntry[]> {
  const supabase = createClient();
  const user_id = await uid();
  const { data, error } = await supabase
    .from("pursuit_entries")
    .select("date, value, note")
    .eq("stat_id", statId)
    .eq("user_id", user_id)
    .order("date", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ date: String(r.date), value: Number(r.value), note: r.note }));
}

export async function logEntry(statId: string, date: string, value: number, note: string | null): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase
    .from("pursuit_entries")
    .upsert({ user_id, stat_id: statId, date, value, note }, { onConflict: "user_id,stat_id,date" });
  if (error) throw error;
}

// --- public preview: what a non-member sees before joining ---------------------

export interface StatSummary {
  statId: string;
  name: string;
  unit: string;
  cadence: "daily" | "whenever";
  direction: "more" | "less";
  participants: number;
  entries: number;
  avgValue: number | null;
  bestValue: number | null;
  lastLogged: string | null;
}

export async function fetchStatSummary(pursuitId: string): Promise<StatSummary[]> {
  const data = await rpcAll("pursuit_stat_summary", { p: pursuitId });
  return data.map((r: any) => ({
    statId: r.stat_id,
    name: r.name,
    unit: r.unit,
    cadence: r.cadence,
    direction: r.direction,
    participants: Number(r.participants),
    entries: Number(r.entries),
    avgValue: r.avg_value == null ? null : Number(r.avg_value),
    bestValue: r.best_value == null ? null : Number(r.best_value),
    lastLogged: r.last_logged ? String(r.last_logged) : null,
  }));
}

export interface ActivityWeek {
  weekStart: string;
  entries: number;
  activeMembers: number;
}

export async function fetchPursuitActivity(pursuitId: string, weeks = 12): Promise<ActivityWeek[]> {
  const data = await rpcAll("pursuit_activity", { p: pursuitId, weeks });
  return data.map((r: any) => ({
    weekStart: String(r.week_start),
    entries: Number(r.entries),
    activeMembers: Number(r.active_members),
  }));
}

export interface SpreadBucket {
  low: number;
  high: number;
  members: number;
}

export async function fetchStatSpread(statId: string): Promise<SpreadBucket[]> {
  const data = await rpcAll("pursuit_stat_spread", { s: statId });
  return data.map((r: any) => ({
    low: Number(r.bucket_low),
    high: Number(r.bucket_high),
    members: Number(r.members),
  }));
}

export interface StatTop {
  memberId: string;
  displayName: string;
  username: string | null;
  score: number;
  entries: number;
}

export async function fetchStatTop(statId: string, n = 5): Promise<StatTop[]> {
  const data = await rpcAll("pursuit_stat_top", { s: statId, n });
  return data.map((r: any) => ({
    memberId: r.member_id,
    displayName: r.display_name,
    username: r.username,
    score: Number(r.score),
    entries: Number(r.entries),
  }));
}

export interface PursuitMember {
  memberId: string;
  displayName: string;
  username: string;
  role: "owner" | "member";
  isDemo: boolean;
  /** Can you open their profile? Names only link through when true. */
  isVisible: boolean;
  team: string;
}

/** Who else is in this pursuit. */
export async function fetchPursuitMembers(pursuitId: string): Promise<PursuitMember[]> {
  const data = await rpcAll("pursuit_member_list", { p: pursuitId });
  return data.map((r: any) => ({
    memberId: r.member_id,
    displayName: r.display_name,
    username: r.username,
    role: r.role,
    isDemo: !!r.is_demo,
    isVisible: !!r.is_visible,
    team: r.team ?? "light",
  }));
}

export interface MemberPursuit {
  id: string;
  name: string;
  kind: string;
  memberCount: number;
}

export async function fetchMemberPursuits(memberId: string): Promise<MemberPursuit[]> {
  const data = await rpcAll("member_pursuits", { member: memberId });
  return data.map((r: any) => ({ id: r.id, name: r.name, kind: r.kind, memberCount: Number(r.member_count) }));
}

/**
 * Every pursuit — built-in or custom — opens on its shared community page.
 * (It used to shortcut Life to /day and Lifts to /lifts, which meant clicking
 * a pursuit dumped you on your own private page and the community hub was
 * effectively unreachable.) The hub links onward to your own logging page.
 */
export function pursuitHref(p: Pick<Pursuit, "id" | "kind">): string {
  return `/pursuits/${p.id}`;
}

/** Where YOU log this pursuit: built-ins have dedicated personal pages. */
export function pursuitLogHref(p: Pick<Pursuit, "id" | "kind">): string | null {
  if (p.kind === "life") return "/day";
  if (p.kind === "lifts") return "/lifts";
  return null;
}
