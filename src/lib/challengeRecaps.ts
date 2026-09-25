"use client";

/**
 * End-of-challenge data: frozen results, the per-member life breakdown, and
 * the admin-approved recaps (migration 0047). Generation lives server-side in
 * src/app/admin/recaps/actions.ts — the API key never reaches the browser.
 */

import { createClient } from "@/lib/supabase/client";

export type RecapStatus = "pending_approval" | "visible";

export interface Recap {
  challengeId: string;
  userId: string;
  body: string;
  status: RecapStatus;
  model: string | null;
  generatedAt: string;
  approvedAt: string | null;
}

export interface ChallengeResult {
  challengeId: string;
  userId: string;
  rank: number;
  score: number | null;
  entries: number | null;
}

export interface LifeSummary {
  userId: string;
  displayName: string;
  productiveHours: number;
  brainrotHours: number;
  sleepHours: number;
  daysLogged: number;
  focus: number | null;
  workmax: number | null;
}

/**
 * Final logs stay open until 12:00 the day after the last day, because people
 * log yesterday this morning. Mirrors challenge_closes_at() in 0047, which is
 * the authority (it uses the owner's timezone; this uses the viewer's).
 */
export function challengeClosesAt(endsOn: string): Date {
  const d = new Date(endsOn + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return d;
}

export function challengeClosed(endsOn: string, now: Date = new Date()): boolean {
  return now >= challengeClosesAt(endsOn);
}

function toRecap(r: any): Recap {
  return {
    challengeId: r.challenge_id,
    userId: r.user_id,
    body: r.body,
    status: r.status,
    model: r.model ?? null,
    generatedAt: r.generated_at,
    approvedAt: r.approved_at ?? null,
  };
}

function toResult(r: any): ChallengeResult {
  return {
    challengeId: r.challenge_id,
    userId: r.user_id,
    rank: Number(r.rank),
    score: r.score == null ? null : Number(r.score),
    entries: r.entries == null ? null : Number(r.entries),
  };
}

/**
 * Freeze the standings. Idempotent server-side. The database's date is UTC, so
 * for the first hours after a Sydney end-of-day it still says "not finished" —
 * that is expected and the caller falls back to live standings.
 */
export async function finalizeChallenge(challengeId: string): Promise<boolean> {
  const { error } = await createClient().rpc("finalize_challenge", { c: challengeId });
  return !error;
}

export async function fetchResults(challengeId: string): Promise<ChallengeResult[]> {
  const { data, error } = await createClient()
    .from("challenge_results")
    .select("challenge_id, user_id, rank, score, entries")
    .eq("challenge_id", challengeId)
    .order("rank");
  if (error) throw error;
  return (data ?? []).map(toResult);
}

/** Your own frozen placing in every finished challenge — the profile cards. */
export async function fetchMyResults(): Promise<ChallengeResult[]> {
  const supabase = createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  const { data, error } = await supabase
    .from("challenge_results")
    .select("challenge_id, user_id, rank, score, entries")
    .eq("user_id", u.user.id);
  if (error) throw error;
  return (data ?? []).map(toResult);
}

export async function fetchLifeSummary(challengeId: string): Promise<LifeSummary[]> {
  const { data, error } = await createClient().rpc("challenge_life_summary", { c: challengeId });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    userId: r.user_id,
    displayName: r.display_name,
    productiveHours: Number(r.productive_hours),
    brainrotHours: Number(r.brainrot_hours),
    sleepHours: Number(r.sleep_hours),
    daysLogged: Number(r.days_logged),
    focus: r.focus == null ? null : Number(r.focus),
    workmax: r.workmax == null ? null : Number(r.workmax),
  }));
}

/** RLS returns only approved recaps to members; the admin gets drafts too. */
export async function fetchRecaps(challengeId?: string): Promise<Recap[]> {
  let q = createClient()
    .from("challenge_recaps")
    .select("challenge_id, user_id, body, status, model, generated_at, approved_at")
    .order("generated_at", { ascending: false });
  if (challengeId) q = q.eq("challenge_id", challengeId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toRecap);
}

/** A recap written outside the generator — pasted from a Claude session. */
export async function saveRecap(challengeId: string, userId: string, body: string, approve: boolean): Promise<void> {
  const supabase = createClient();
  const { data: u } = await supabase.auth.getUser();
  const now = new Date().toISOString();
  const { error } = await supabase.from("challenge_recaps").upsert({
    challenge_id: challengeId,
    user_id: userId,
    body: body.trim(),
    status: approve ? "visible" : "pending_approval",
    model: "pasted (Claude Code session)",
    generated_at: now,
    updated_at: now,
    approved_at: approve ? now : null,
    approved_by: approve ? u.user?.id ?? null : null,
  });
  if (error) throw error;
}

export async function updateRecap(
  challengeId: string,
  userId: string,
  patch: { body?: string; status?: RecapStatus },
): Promise<void> {
  const supabase = createClient();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.body !== undefined) row.body = patch.body.trim();
  if (patch.status === "visible") {
    const { data: u } = await supabase.auth.getUser();
    row.status = "visible";
    row.approved_at = new Date().toISOString();
    row.approved_by = u.user?.id ?? null;
  } else if (patch.status === "pending_approval") {
    row.status = "pending_approval";
    row.approved_at = null;
    row.approved_by = null;
  }
  // .select() so an RLS-filtered zero-row update reads as the failure it is.
  const { data, error } = await supabase
    .from("challenge_recaps")
    .update(row)
    .eq("challenge_id", challengeId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Recap not found, or you are not an admin.");
}
