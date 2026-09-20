"use client";

/** Money: spending, income, categories, and challenges. */

import { createClient } from "@/lib/supabase/client";

export interface SpendCategory {
  id: string;
  name: string;
  grp: string;
  essential: boolean;
  isMine: boolean;
  hidden: boolean;
  sort: number;
}

export interface SpendEntry {
  id: string;
  date: string;
  amount: number;
  categoryId: string | null;
  item: string | null;
  note: string | null;
}

export interface SpendSummary {
  total: number;
  essential: number;
  nonEssential: number;
  income: number;
  nonEssentialPct: number | null;
  entries: number;
}

async function uid(): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

export async function fetchCategories(): Promise<SpendCategory[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("my_spend_categories");
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    grp: r.grp,
    essential: !!r.essential,
    isMine: !!r.is_mine,
    hidden: !!r.hidden,
    sort: r.sort,
  }));
}

export async function createCategory(name: string, grp: string, essential: boolean): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase.from("spend_categories").insert({ user_id, name, grp, essential, sort: 200 });
  if (error) throw error;
}

/** Override a built-in's essential flag for yourself only, or hide it. */
export async function setCategoryPref(categoryId: string, patch: { essential?: boolean; hidden?: boolean }): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase
    .from("spend_category_prefs")
    .upsert({ user_id, category_id: categoryId, ...patch }, { onConflict: "user_id,category_id" });
  if (error) throw error;
}

export async function fetchSpend(fromDate: string, toDate: string): Promise<SpendEntry[]> {
  const supabase = createClient();
  const user_id = await uid();
  const { data, error } = await supabase
    .from("spend_entries")
    .select("id, date, amount, category_id, item, note")
    .eq("user_id", user_id)
    .gte("date", fromDate)
    .lte("date", toDate)
    .order("date", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    date: String(r.date),
    amount: Number(r.amount),
    categoryId: r.category_id,
    item: r.item,
    note: r.note,
  }));
}

export interface NewSpend {
  date: string;
  amount: number;
  categoryId: string | null;
  item?: string | null;
  note?: string | null;
}

/** One insert for many rows — the bulk-entry path. */
export async function addSpend(rows: NewSpend[]): Promise<void> {
  if (rows.length === 0) return;
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase.from("spend_entries").insert(
    rows.map((r) => ({
      user_id,
      date: r.date,
      amount: r.amount,
      category_id: r.categoryId,
      item: r.item ?? null,
      note: r.note ?? null,
    }))
  );
  if (error) throw error;
}

export async function deleteSpend(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("spend_entries").delete().eq("id", id);
  if (error) throw error;
}

export async function updateSpend(id: string, patch: Partial<NewSpend>): Promise<void> {
  const supabase = createClient();
  const row: Record<string, unknown> = {};
  if (patch.amount !== undefined) row.amount = patch.amount;
  if (patch.categoryId !== undefined) row.category_id = patch.categoryId;
  if (patch.date !== undefined) row.date = patch.date;
  if (patch.item !== undefined) row.item = patch.item;
  const { error } = await supabase.from("spend_entries").update(row).eq("id", id);
  if (error) throw error;
}

/** Re-categorise many entries at once — the "bulk categorise" ask. */
export async function bulkCategorise(ids: string[], categoryId: string): Promise<void> {
  if (ids.length === 0) return;
  const supabase = createClient();
  const { error } = await supabase.from("spend_entries").update({ category_id: categoryId }).in("id", ids);
  if (error) throw error;
}

export async function addIncome(date: string, amount: number, source?: string): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase.from("income_entries").insert({ user_id, date, amount, source: source ?? null });
  if (error) throw error;
}

export async function fetchIncome(fromDate: string, toDate: string) {
  const supabase = createClient();
  const user_id = await uid();
  const { data, error } = await supabase
    .from("income_entries")
    .select("id, date, amount, source")
    .eq("user_id", user_id)
    .gte("date", fromDate)
    .lte("date", toDate)
    .order("date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, date: String(r.date), amount: Number(r.amount), source: r.source }));
}

export async function deleteIncome(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("income_entries").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchSummary(fromDate: string, toDate: string): Promise<SpendSummary> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("spend_summary", { from_date: fromDate, to_date: toDate });
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) ?? {};
  return {
    total: Number(r.total ?? 0),
    essential: Number(r.essential ?? 0),
    nonEssential: Number(r.non_essential ?? 0),
    income: Number(r.income ?? 0),
    nonEssentialPct: r.non_essential_pct == null ? null : Number(r.non_essential_pct),
    entries: Number(r.entries ?? 0),
  };
}

export interface CategoryTotal {
  categoryId: string | null;
  name: string;
  grp: string;
  essential: boolean;
  total: number;
  entries: number;
}

export async function fetchByCategory(fromDate: string, toDate: string): Promise<CategoryTotal[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("spend_by_category", { from_date: fromDate, to_date: toDate });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    categoryId: r.category_id,
    name: r.name,
    grp: r.grp,
    essential: !!r.essential,
    total: Number(r.total),
    entries: Number(r.entries),
  }));
}

export interface DailyTotal {
  date: string;
  total: number;
  essential: number;
  nonEssential: number;
}

export async function fetchDaily(fromDate: string, toDate: string): Promise<DailyTotal[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("spend_daily", { from_date: fromDate, to_date: toDate });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    date: String(r.date),
    total: Number(r.total),
    essential: Number(r.essential),
    nonEssential: Number(r.non_essential),
  }));
}

/** Frequently bought things, so "coffee" autofills its category and last price. */
export interface RecentItem {
  item: string;
  categoryId: string | null;
  uses: number;
  lastAmount: number | null;
}

export async function fetchRecentItems(): Promise<RecentItem[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("spend_recent_items", { limit_n: 60 });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    item: r.item as string,
    categoryId: (r.category_id ?? null) as string | null,
    uses: Number(r.uses),
    lastAmount: r.last_amount == null ? null : Number(r.last_amount),
  }));
}

// --- challenges ---------------------------------------------------------------

/**
 * A challenge is one sentence: over THIS WINDOW, rank members by THIS NUMBER,
 * where MORE or LESS wins. The three parts are independent —
 *
 *   metric     what number to compute
 *   direction  which end of it wins ('more' | 'less')
 *   statId     which pursuit stat, when metric is 'pursuit_stat'
 *
 * `lower_nonessential` and `lower_nonessential_pct` are the two original
 * spellings from migration 0035, which baked the direction into the name.
 * They still exist on live rows (Budget Baddies is one) and still rank
 * identically; `canonicalMetric()` folds them onto their new names, exactly
 * as `challenge_metric()` does in SQL. Never write them on a new challenge.
 */
export type ChallengeMetric =
  | "lower_nonessential"
  | "lower_nonessential_pct"
  | "money_nonessential"
  | "money_nonessential_pct"
  | "money_total"
  | "life_productive_hours"
  | "life_workmax"
  | "life_focus"
  | "life_brainrot_hours"
  | "life_sleep_hours"
  | "life_streak"
  | "pursuit_stat";

export type ChallengeDirection = "more" | "less";
export type MetricFamily = "money" | "life" | "stat";

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
  "These charts need migration 0036 — run supabase/apply_0036.sql in the Supabase SQL editor.";

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
      throw new Error("Income overrides need migration 0036 — run supabase/apply_0036.sql in the SQL editor.");
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
        "This kind of challenge needs migration 0038 — run supabase/migrations/0038_flexible_challenges.sql in the Supabase SQL editor."
      );
    throw error;
  }
  await supabase.from("challenge_members").insert({ challenge_id: data.id, user_id: owner_id });
  return data.id as string;
}

// --- the metric vocabulary ------------------------------------------------------
//
// Mirrors challenge_metric_*() in migration 0038. The SQL is the authority —
// it computes and ranks — but the picker needs the same list, and the client
// needs to format a score it did not compute.

export const MONEY_PURSUIT_ID = "33333333-3333-4333-8333-333333333305";
export const LIFE_PURSUIT_ID = "33333333-3333-4333-8333-333333333301";

export interface MetricOption {
  metric: ChallengeMetric;
  family: MetricFamily;
  /** The noun, without a "most"/"least" on the front. */
  noun: string;
  /** One line explaining where the number comes from. */
  hint: string;
  direction: ChallengeDirection;
  unit: string;
  group: string;
}

/**
 * Everything the UI may offer, in picker order. Legacy spellings are NOT here:
 * they are readable, not writable. Every entry has a matching branch in
 * challenge_standings() — if the server cannot rank it, it does not appear.
 */
export const CHALLENGE_METRICS: MetricOption[] = [
  {
    metric: "money_nonessential",
    family: "money",
    noun: "non-essential spending",
    hint: "What you spent on things you didn't need. Essentials — rent, groceries, bills, transport — don't count.",
    direction: "less",
    unit: "currency",
    group: "Money",
  },
  {
    metric: "money_nonessential_pct",
    family: "money",
    noun: "non-essential spending, as a share of income",
    hint: "The same number over your own income, so a student and a surgeon compete fairly.",
    direction: "less",
    unit: "%",
    group: "Money",
  },
  {
    metric: "money_total",
    family: "money",
    noun: "total spending",
    hint: "Everything logged, essential or not.",
    direction: "less",
    unit: "currency",
    group: "Money",
  },
  {
    metric: "life_productive_hours",
    family: "life",
    noun: "productive hours",
    hint: "Hours in your productive categories on the day grid. Default: Work and Sports.",
    direction: "more",
    unit: "h",
    group: "Life",
  },
  {
    metric: "life_workmax",
    family: "life",
    noun: "WorkMax",
    hint: "Productive hours weighted by how clean they were — 79 productive hours next to 20 of brainrot scores 62.",
    direction: "more",
    unit: "h",
    group: "Life",
  },
  {
    metric: "life_focus",
    family: "life",
    noun: "focus score",
    hint: "Productive as a share of productive + brainrot, 0 to 100. Ignores volume entirely.",
    direction: "more",
    unit: "pts",
    group: "Life",
  },
  {
    metric: "life_brainrot_hours",
    family: "life",
    noun: "brainrot hours",
    hint: "Hours in your brainrot categories. Default: Other and Leisure.",
    direction: "less",
    unit: "h",
    group: "Life",
  },
  {
    metric: "life_sleep_hours",
    family: "life",
    noun: "sleep",
    hint: "Hours logged as Sleep on the day grid.",
    direction: "more",
    unit: "h",
    group: "Life",
  },
  {
    metric: "life_streak",
    family: "life",
    noun: "logging streak",
    hint: "The longest run of consecutive days with anything logged. A consistency contest, not a performance one.",
    direction: "more",
    unit: "days",
    group: "Life",
  },
  {
    metric: "pursuit_stat",
    family: "stat",
    noun: "a pursuit stat",
    hint: "Any stat from a pursuit you're in — pages read, kilometres run, cigarettes not smoked.",
    direction: "more",
    unit: "",
    group: "Pursuits",
  },
];

/** Legacy spellings fold onto their new names. Same mapping as SQL. */
export function canonicalMetric(m: ChallengeMetric | string): ChallengeMetric {
  if (m === "lower_nonessential") return "money_nonessential";
  if (m === "lower_nonessential_pct") return "money_nonessential_pct";
  return (m as ChallengeMetric) ?? "money_nonessential";
}

export function metricOption(m: ChallengeMetric | string): MetricOption | undefined {
  const canon = canonicalMetric(m);
  return CHALLENGE_METRICS.find((o) => o.metric === canon);
}

export function metricFamily(m: ChallengeMetric | string): MetricFamily {
  return metricOption(m)?.family ?? "life";
}

export function defaultDirection(m: ChallengeMetric | string, statDirection?: ChallengeDirection | null): ChallengeDirection {
  if (canonicalMetric(m) === "pursuit_stat") return statDirection ?? "more";
  return metricOption(m)?.direction ?? "more";
}

export function metricUnit(m: ChallengeMetric | string, statUnit?: string | null): string {
  if (canonicalMetric(m) === "pursuit_stat") return (statUnit ?? "").trim();
  return metricOption(m)?.unit ?? "";
}

/** "Most productive hours". Matches challenge_metric_label() in SQL. */
export function metricLabel(
  m: ChallengeMetric | string,
  direction: ChallengeDirection,
  statName?: string | null
): string {
  const canon = canonicalMetric(m);
  if (canon === "life_streak") return direction === "less" ? "Shortest logging streak" : "Longest logging streak";
  const noun = canon === "pursuit_stat" ? (statName?.trim() || "a pursuit stat") : metricOption(canon)?.noun ?? "the score";
  return `${direction === "less" ? "Least" : "Most"} ${noun}`;
}

/** Which pursuit a challenge on this metric hangs off, so members can log. */
export function pursuitForMetric(m: ChallengeMetric | string): string | null {
  const fam = metricFamily(m);
  if (fam === "money") return MONEY_PURSUIT_ID;
  if (fam === "life") return LIFE_PURSUIT_ID;
  return null; // a stat challenge points at the stat's own pursuit
}

/**
 * Render a score in its own unit. 'currency' is the sentinel the server sends
 * for money metrics — the symbol is the viewer's, not a hardcoded dollar.
 */
export function formatScore(value: number | null | undefined, unit: string, currency?: string): string {
  if (value == null) return "—";
  if (unit === "currency") return money(value, currency);
  const n = value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (unit === "%") return `${n}%`;
  if (unit === "") return n;
  return `${n} ${unit}`;
}

/**
 * Currency. Stored on the profile so challenge standings can refuse to compare
 * dollars with euros — a leaderboard that silently mixes currencies is worse
 * than no leaderboard.
 */
export const CURRENCIES = ["AUD", "USD", "GBP", "EUR", "NZD", "CAD", "JPY", "SGD"] as const;
export type Currency = (typeof CURRENCIES)[number];

const SYMBOLS: Record<string, string> = {
  AUD: "$", USD: "$", NZD: "$", CAD: "$", GBP: "£", EUR: "€", JPY: "¥", SGD: "$",
};

let cachedCurrency: string | null = null;

export function currencySymbol(code?: string | null): string {
  return SYMBOLS[code ?? cachedCurrency ?? "AUD"] ?? "$";
}

export async function fetchCurrency(): Promise<string> {
  if (cachedCurrency) return cachedCurrency;
  try {
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return "AUD";
    const { data } = await supabase.from("profiles").select("currency").eq("id", auth.user.id).single();
    cachedCurrency = data?.currency ?? "AUD";
    return cachedCurrency!;
  } catch {
    return "AUD";
  }
}

export async function setCurrency(code: string): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase.from("profiles").update({ currency: code }).eq("id", user_id);
  if (error) throw error;
  cachedCurrency = code;
}

export function money(n: number | null | undefined, currency?: string): string {
  if (n == null) return "—";
  const sym = currencySymbol(currency);
  return `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
