"use client";

/**
 * Pursuit-request data layer. RLS lives in migration 0044:
 *   - a user sees + inserts their own requests only
 *   - an admin sees + updates all
 * so most of what this module does is a thin wrapper — the DB decides.
 */

import { createClient } from "@/lib/supabase/client";

export type PursuitRequestStatus = "pending" | "approved" | "rejected" | "implemented";

export interface PursuitRequest {
  id: string;
  userId: string;
  sentence: string;
  context: string | null;
  status: PursuitRequestStatus;
  reviewerNotes: string | null;
  reviewerResponse: string | null;
  implementedPursuitId: string | null;
  createdAt: string;
  updatedAt: string;
}

function fromRow(r: any): PursuitRequest {
  return {
    id: r.id,
    userId: r.user_id,
    sentence: r.sentence,
    context: r.context ?? null,
    status: r.status,
    reviewerNotes: r.reviewer_notes ?? null,
    reviewerResponse: r.reviewer_response ?? null,
    implementedPursuitId: r.implemented_pursuit_id ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

async function uid(): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

/** Whether the current signed-in user is a DayMax admin (server-checked via
 *  the is_daymax_admin() SQL function). Safe to call for anon users — returns
 *  false rather than throwing. */
export async function isDaymaxAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("is_daymax_admin");
  if (error) return false;
  return !!data;
}

// -- user actions -------------------------------------------------------------

export async function createRequest(sentence: string, context: string | null): Promise<PursuitRequest> {
  const supabase = createClient();
  const user_id = await uid();
  const payload = {
    user_id,
    sentence: sentence.trim(),
    context: context && context.trim() ? context.trim() : null,
  };
  const { data, error } = await supabase.from("pursuit_requests").insert(payload).select("*").single();
  if (error) throw error;
  return fromRow(data);
}

export async function fetchMyRequests(): Promise<PursuitRequest[]> {
  const supabase = createClient();
  const user_id = await uid();
  const { data, error } = await supabase
    .from("pursuit_requests")
    .select("*")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

// -- admin actions ------------------------------------------------------------
// These will fail with an RLS error for a non-admin. The admin UI hides them,
// but we don't trust that as the security boundary — the DB does.

export async function fetchAllRequests(filter?: { status?: PursuitRequestStatus }): Promise<PursuitRequest[]> {
  const supabase = createClient();
  let q = supabase.from("pursuit_requests").select("*").order("created_at", { ascending: false });
  if (filter?.status) q = q.eq("status", filter.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

export interface AdminPatch {
  status?: PursuitRequestStatus;
  reviewerNotes?: string | null;
  reviewerResponse?: string | null;
  implementedPursuitId?: string | null;
}

export async function updateRequest(id: string, patch: AdminPatch): Promise<PursuitRequest> {
  const supabase = createClient();
  const row: Record<string, any> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.reviewerNotes !== undefined) row.reviewer_notes = patch.reviewerNotes;
  if (patch.reviewerResponse !== undefined) row.reviewer_response = patch.reviewerResponse;
  if (patch.implementedPursuitId !== undefined) row.implemented_pursuit_id = patch.implementedPursuitId;
  const { data, error } = await supabase.from("pursuit_requests").update(row).eq("id", id).select("*").single();
  if (error) throw error;
  return fromRow(data);
}

export async function deleteRequest(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("pursuit_requests").delete().eq("id", id);
  if (error) throw error;
}

// -- brief formatter ----------------------------------------------------------

/**
 * The exact template the coordinator specified — copied to clipboard by the
 * admin UI so a review can be turned into a coding-session brief without
 * retyping. Kept pure so it's easy to unit test.
 */
export function formatBrief(r: PursuitRequest, approvedOn: Date = new Date()): string {
  const iso = approvedOn.toISOString().slice(0, 10);
  return [
    `Task from pursuit_requests row ${r.id}:`,
    `User (${r.userId}) requests: ${r.sentence}`,
    `Context: ${r.context && r.context.trim() ? r.context : "(none)"}`,
    `Approved by John on ${iso}.`,
    `Build this as a pursuit in DayMax. Link back to the request row when done via \`implemented_pursuit_id\`.`,
  ].join("\n");
}
