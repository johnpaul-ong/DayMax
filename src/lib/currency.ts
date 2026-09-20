"use client";

/**
 * Currency stored on the profile so challenge standings can refuse to
 * compare dollars with euros — a leaderboard that silently mixes
 * currencies is worse than no leaderboard.
 *
 * Extracted from money.ts. money.ts re-exports these names for
 * backwards compatibility, so existing import sites keep working.
 */

import { createClient } from "@/lib/supabase/client";

export const CURRENCIES = ["AUD", "USD", "GBP", "EUR", "NZD", "CAD", "JPY", "SGD"] as const;
export type Currency = (typeof CURRENCIES)[number];

const SYMBOLS: Record<string, string> = {
  AUD: "$", USD: "$", NZD: "$", CAD: "$", GBP: "£", EUR: "€", JPY: "¥", SGD: "$",
};

let cachedCurrency: string | null = null;

/**
 * Clear the module-scoped currency cache. Wired to Supabase's
 * SIGNED_OUT event below so the next signed-in user on the same
 * tab doesn't inherit the previous user's currency preference.
 */
export function invalidateCurrencyCache(): void {
  cachedCurrency = null;
}

// Register the sign-out listener ONCE per module load. Guarded so
// hot-reload doesn't stack listeners. Browser only; no-op on server
// (module resolves without a window).
if (typeof window !== "undefined") {
  try {
    createClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") invalidateCurrencyCache();
    });
  } catch { /* SSR safety */ }
}

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
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  const { error } = await supabase.from("profiles").update({ currency: code }).eq("id", data.user.id);
  if (error) throw error;
  cachedCurrency = code;
}

export function money(n: number | null | undefined, currency?: string): string {
  if (n == null) return "—";
  const sym = currencySymbol(currency);
  return `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
