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

export interface Challenge {
  id: string;
  name: string;
  description: string;
  metric: "lower_nonessential" | "lower_nonessential_pct";
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
  income: number | null;
  pct: number | null;
  entries: number;
  sharesAmounts: boolean;
  isMe: boolean;
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
    income: r.income == null ? null : Number(r.income),
    pct: r.pct == null ? null : Number(r.pct),
    entries: Number(r.entries ?? 0),
    sharesAmounts: !!r.shares_amounts,
    isMe: !!r.is_me,
  }));
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
  metric: Challenge["metric"];
  pursuitId?: string | null;
}): Promise<string> {
  const supabase = createClient();
  const owner_id = await uid();
  const { data, error } = await supabase
    .from("challenges")
    .insert({
      owner_id,
      name: c.name,
      description: c.description,
      starts_on: c.startsOn,
      ends_on: c.endsOn,
      metric: c.metric,
      pursuit_id: c.pursuitId ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  await supabase.from("challenge_members").insert({ challenge_id: data.id, user_id: owner_id });
  return data.id as string;
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
