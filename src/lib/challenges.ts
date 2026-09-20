"use client";

/**
 * Challenge data layer: RPC-backed fetch/mutation for challenges,
 * standings, daily race data, invites and creation. The metric
 * vocabulary is in challengeMetrics.ts; formatting a score is in
 * currency.ts + challengeMetrics.formatScore.
 *
 * Extracted from money.ts. money.ts re-exports everything here for
 * backwards compatibility.
 */

import { createClient } from "@/lib/supabase/client";
import {
  defaultDirection,
  metricLabel,
  metricUnit,
  pursuitForMetric,
  type ChallengeDirection,
  type ChallengeMetric,
} from "./challengeMetrics";

async function uid(): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

export interface Challenge {
  id: string;
  name: string;
  description: string;
  metric: ChallengeMetric;
  /** Which end wins. The server resolves the default, so this is never null. */
  direction: ChallengeDirection;
  /** Set when metric is 'pursuit_stat'. */
  statId: string | null;
  /** The pursuit this hangs off — where members go to log. */
  pursuitId: string | null;
  /** "Most productive hours". Computed server-side so a stat's own name is in it. */
  metricLabel: string;
  /** 'currency' | '%' | 'h' | 'pts' | 'days' | a stat's own unit | ''. */
  scoreUnit: string;
  startsOn: string;
  endsOn: string;
  members: number;
  isMember: boolean;
  isOwner: boolean;
  finalized: boolean;
  daysLeft: number;
  inviteToken: string | null;
}

export interface Standing {
  userId: string;
  displayName: string;
  username: string | null;
  team: string;
  score: number | null;
  nonEssential: number | null;
  essential: number | null;
  total: number | null;
  income: number | null;
  pct: number | null;
  entries: number;
  perDay: number;
  topCategory: string | null;
  topCategoryAmount: number | null;
  sharesAmounts: boolean;
  isMe: boolean;
  /** How to format `score`. 'currency' means "use money()". */
  scoreUnit: string;
  /** "Least non-essential spending" — what the number in `score` is. */
  scoreLabel: string;
  /** True when the SMALLEST score wins. Rows arrive leader-first either way. */
  rankLess: boolean;
}

export interface ChallengeDay {
  date: string;
  userId: string;
  displayName: string;
  spent: number;
  running: number;
}

export interface ChallengeCategory {
  name: string;
  essential: boolean;
  total: number;
  people: number;
}

export interface InvitableFriend {
  memberId: string;
  displayName: string;
  username: string | null;
  invited: boolean;
}

export interface PendingInvite {
  challengeId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  invitedByName: string;
}

export async function fetchChallenges(): Promise<Challenge[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("my_challenges");
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    metric: r.metric,
    // Pre-0038 databases don't return these, so fall back to the same defaults
    // the SQL uses rather than rendering "undefined" on every card.
    direction: (r.direction ?? defaultDirection(r.metric)) as ChallengeDirection,
    statId: r.stat_id ?? null,
    pursuitId: r.pursuit_id ?? null,
    metricLabel: r.metric_label ?? metricLabel(r.metric, r.direction ?? defaultDirection(r.metric)),
    scoreUnit: r.score_unit ?? metricUnit(r.metric),
    startsOn: String(r.starts_on),
    endsOn: String(r.ends_on),
    members: Number(r.members),
    isMember: !!r.is_member,
    isOwner: !!r.is_owner,
    finalized: !!r.finalized,
    daysLeft: Number(r.days_left),
    inviteToken: r.invite_token,
  }));
}

export async function fetchStandings(challengeId: string): Promise<Standing[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("challenge_standings", { c: challengeId });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    userId: r.user_id,
    displayName: r.display_name,
    username: r.username,
    team: r.team ?? "light",
    score: r.score == null ? null : Number(r.score),
    nonEssential: r.non_essential == null ? null : Number(r.non_essential),
    essential: r.essential == null ? null : Number(r.essential),
    total: r.total == null ? null : Number(r.total),
    income: r.income == null ? null : Number(r.income),
    pct: r.pct == null ? null : Number(r.pct),
    entries: Number(r.entries ?? 0),
    perDay: Number(r.per_day ?? 0),
    topCategory: r.top_category ?? null,
    topCategoryAmount: r.top_category_amount == null ? null : Number(r.top_category_amount),
    sharesAmounts: !!r.shares_amounts,
    isMe: !!r.is_me,
    scoreUnit: r.score_unit ?? "currency",
    scoreLabel: r.score_label ?? "Least non-essential spending",
    rankLess: r.rank_less ?? true,
  }));
}

/** Cumulative non-essential spend per person, per day — the race chart. */
const MIGRATION_0036 =
  "These charts are temporarily unavailable. If it persists, contact the app owner.";

export async function fetchChallengeDaily(challengeId: string): Promise<ChallengeDay[]> {
  // One row per member per day: a 90-day challenge with a dozen people is over
  // a thousand rows, and Supabase caps an RPC at 1000. Page it. (challenge_daily
  // orders by date then user id precisely so paging can't skip or duplicate.)
  const supabase = createClient();
  const data: any[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data: chunk, error } = await supabase
      .rpc("challenge_daily", { c: challengeId })
      .range(from, from + page - 1);
    if (error) throw new Error(MIGRATION_0036);
    if (!chunk || (chunk as any[]).length === 0) break;
    data.push(...(chunk as any[]));
    if ((chunk as any[]).length < page) break;
  }
  return (data ?? []).map((r: any) => ({
    date: String(r.date),
    userId: r.user_id,
    displayName: r.display_name,
    spent: Number(r.spent),
    running: Number(r.running),
  }));
}

/** What the whole group is spending on. Aggregate — leaks no individual. */
export async function fetchChallengeCategories(challengeId: string): Promise<ChallengeCategory[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("challenge_categories", { c: challengeId });
  if (error) throw new Error(MIGRATION_0036);
  return (data ?? []).map((r: any) => ({
    name: r.name,
    essential: !!r.essential,
    total: Number(r.total),
    people: Number(r.people),
  }));
}

export async function fetchInvitableFriends(challengeId: string): Promise<InvitableFriend[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("challenge_invitable_friends", { c: challengeId });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    memberId: r.member_id,
    displayName: r.display_name,
    username: r.username,
    invited: !!r.invited,
  }));
}

export async function inviteFriend(challengeId: string, friendId: string): Promise<void> {
  const supabase = createClient();
  const invited_by = await uid();
  const { error } = await supabase
    .from("challenge_invites")
    .insert({ challenge_id: challengeId, invited_user: friendId, invited_by });
  if (error && !String(error.message).includes("duplicate")) throw error;
}

export async function fetchMyInvites(): Promise<PendingInvite[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("my_challenge_invites");
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    challengeId: r.challenge_id,
    name: r.name,
    startsOn: String(r.starts_on),
    endsOn: String(r.ends_on),
    invitedByName: r.invited_by_name,
  }));
}

export async function dismissInvite(challengeId: string): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  await supabase.from("challenge_invites").delete().eq("challenge_id", challengeId).eq("invited_user", user_id);
}

/** Your income baseline for a challenge. null = let the app work it out. */
export async function setIncomeOverride(challengeId: string, amount: number | null): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  // .select() matters: without it PostgREST reports success for an UPDATE that
  // matched zero rows, so setting your income on a challenge you had not yet
  // joined looked like it worked and changed nothing.
  const { data, error } = await supabase
    .from("challenge_members")
    .update({ income_override: amount })
    .eq("challenge_id", challengeId)
    .eq("user_id", user_id)
    .select("user_id");
  if (error) {
    if (String(error.message).includes("income_override"))
      throw new Error("Income overrides are temporarily unavailable. If it persists, contact the app owner.");
    throw error;
  }
  if (!data || data.length === 0) {
    const { error: insErr } = await supabase
      .from("challenge_members")
      .insert({ challenge_id: challengeId, user_id, income_override: amount });
    if (insErr) throw new Error("Join the challenge first, then set your income.");
  }
}

export async function joinChallenge(id: string): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase.from("challenge_members").insert({ challenge_id: id, user_id });
  if (error && !String(error.message).includes("duplicate")) throw error;
  // joining the challenge should also put you in its pursuit, so you can log
  const { data: ch } = await supabase.from("challenges").select("pursuit_id").eq("id", id).single();
  if (ch?.pursuit_id) {
    await supabase.from("pursuit_members").insert({ pursuit_id: ch.pursuit_id, user_id }).then(() => {}, () => {});
  }
}

export async function leaveChallenge(id: string): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase.from("challenge_members").delete().eq("challenge_id", id).eq("user_id", user_id);
  if (error) throw error;
}

export async function setShareAmounts(challengeId: string, share: boolean): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase
    .from("challenge_members")
    .update({ share_amounts: share })
    .eq("challenge_id", challengeId)
    .eq("user_id", user_id);
  if (error) throw error;
}

export async function joinByToken(token: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("join_challenge", { token });
  if (error) throw error;
  return data as string;
}

export async function createChallenge(c: {
  name: string;
  description: string;
  startsOn: string;
  endsOn: string;
  metric: ChallengeMetric;
  /** Omit to take the metric's natural direction (a stat uses its own). */
  direction?: ChallengeDirection | null;
  /** Required when metric is 'pursuit_stat'; the DB rejects it otherwise. */
  statId?: string | null;
  pursuitId?: string | null;
}): Promise<string> {
  const supabase = createClient();
  const owner_id = await uid();
  if (c.metric === "pursuit_stat" && !c.statId) throw new Error("Pick a stat to compete on.");
  const { data, error } = await supabase
    .from("challenges")
    .insert({
      owner_id,
      name: c.name,
      description: c.description,
      starts_on: c.startsOn,
      ends_on: c.endsOn,
      metric: c.metric,
      direction: c.direction ?? null,
      stat_id: c.statId ?? null,
      pursuit_id: c.pursuitId ?? pursuitForMetric(c.metric),
    })
    .select("id")
    .single();
  if (error) {
    const msg = String(error.message ?? error);
    // The CHECK constraint from 0035 only allowed the two money metrics.
    if (msg.includes("challenges_metric") || msg.includes("metric_check") || msg.includes("direction"))
      throw new Error(
        "This kind of challenge is temporarily unavailable. If it persists, contact the app owner."
      );
    throw error;
  }
  await supabase.from("challenge_members").insert({ challenge_id: data.id, user_id: owner_id });
  return data.id as string;
}
