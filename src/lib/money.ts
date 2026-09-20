"use client";

/**
 * Money: your own spending, income and categories.
 *
 * Historically this file also held the challenge-metric vocabulary, the
 * challenge data layer and the currency plumbing — it grew to ~880 lines
 * and became the answer to "where does X live?" for every money-adjacent
 * thing in the app. That's now three sibling modules:
 *
 *   currency.ts           CURRENCIES, money(), fetchCurrency, setCurrency…
 *   challengeMetrics.ts   the metric registry + formatScore()
 *   challenges.ts         RPC-backed fetch/mutation for challenges
 *
 * This module re-exports every symbol they used to expose so import sites
 * (`from "@/lib/money"`) keep working. The re-exports are cheap and let
 * you deep-link the smaller file when writing new code, without a
 * codebase-wide rename.
 */

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
  // Was `.limit(2000)` -- silently truncated a heavy year. Paged.
  const supabase = createClient();
  const user_id = await uid();
  const all: any[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("spend_entries")
      .select("id, date, amount, category_id, item, note")
      .eq("user_id", user_id)
      .gte("date", fromDate)
      .lte("date", toDate)
      .order("date", { ascending: false })
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < page) break;
  }
  return all.map((r: any) => ({
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

/**
 * The date of the user's most recent income entry, or null if they've
 * never logged income. Callers use this as the "since last paycheck"
 * lower bound for a summary — the natural pay-period a person actually
 * lives in, which almost never aligns with a calendar month.
 */
export async function lastPaycheckDate(): Promise<string | null> {
  const supabase = createClient();
  const user_id = await uid();
  const { data, error } = await supabase
    .from("income_entries")
    .select("date")
    .eq("user_id", user_id)
    .order("date", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row?.date ? String(row.date) : null;
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

// --- backwards-compat re-exports --------------------------------------
//
// The three modules the challenge/currency code split into. Everything is
// re-exported so `import { ... } from "@/lib/money"` keeps working for
// every existing site; new code can import from the deeper file directly.

export {
  CURRENCIES,
  currencySymbol,
  fetchCurrency,
  invalidateCurrencyCache,
  money,
  setCurrency,
  type Currency,
} from "./currency";

export {
  CHALLENGE_METRICS,
  LIFE_PURSUIT_ID,
  MONEY_PURSUIT_ID,
  canonicalMetric,
  defaultDirection,
  formatScore,
  metricFamily,
  metricLabel,
  metricOption,
  metricUnit,
  pursuitForMetric,
  type ChallengeDirection,
  type ChallengeMetric,
  type MetricFamily,
  type MetricOption,
} from "./challengeMetrics";

export {
  createChallenge,
  dismissInvite,
  fetchChallengeCategories,
  fetchChallengeDaily,
  fetchChallenges,
  fetchInvitableFriends,
  fetchMyInvites,
  fetchStandings,
  inviteFriend,
  joinByToken,
  joinChallenge,
  leaveChallenge,
  setIncomeOverride,
  setShareAmounts,
  type Challenge,
  type ChallengeCategory,
  type ChallengeDay,
  type InvitableFriend,
  type PendingInvite,
  type Standing,
} from "./challenges";
