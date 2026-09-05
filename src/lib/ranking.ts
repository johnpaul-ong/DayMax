/**
 * Productivity ranking: hours per bucket (productive / brainrot / other)
 * for a day, a week, or all time. Uses parent-category totals ONLY —
 * never labels. Bucket assignment is configurable per user; defaults:
 * productive = Work + Sports, brainrot = Other + Leisure.
 */

import { HOURS_PER_SLOT, type Bucket } from "./categories";
import type { BucketSettings, BucketTotals, DayEntry } from "./types";

export function emptyTotals(): BucketTotals {
  return { productive: 0, brainrot: 0, other: 0 };
}

/** Sum hours per category from slot entries. */
export function hoursByCategory(entries: Pick<DayEntry, "category">[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const e of entries) out[e.category] = (out[e.category] ?? 0) + HOURS_PER_SLOT;
  return out;
}

export function bucketize(catHours: Record<number, number>, settings: BucketSettings): BucketTotals {
  const totals = emptyTotals();
  for (const [code, hours] of Object.entries(catHours)) {
    const bucket: Bucket = settings[Number(code)] ?? "other";
    totals[bucket] += hours;
  }
  return totals;
}

/** productive:brainrot ratio; Infinity-safe (returns null when brainrot is 0). */
export function productiveRatio(t: BucketTotals): number | null {
  if (t.brainrot === 0) return t.productive > 0 ? null : 0;
  return Math.round((t.productive / t.brainrot) * 100) / 100;
}

/**
 * Focus score: productive / (productive + brainrot) * 100, bounded 0..100.
 * The fair between-people stat — a raw ratio explodes (4:1 vs 8:1 can be one
 * lazy hour apart) and hits infinity on perfect days. 50 = break-even.
 * Null when nothing productive or brainrot was logged.
 */
export function focusScore(t: BucketTotals): number | null {
  const scored = t.productive + t.brainrot;
  if (scored === 0) return null;
  return Math.round((t.productive / scored) * 1000) / 10;
}

/**
 * WorkMax: focus score as a 0..1 quality multiplier, times the hours actually
 * put in. Focus score alone says nothing about volume — someone with 31 clean
 * hours and someone with 79 clean hours both score 100 — so WorkMax is the
 * one worth ranking on. Reads as "effective productive hours": you get full
 * credit for productive time only if you weren't also rotting.
 *
 *   31h productive, 0h brainrot  -> 1.00 x 31 = 31.0
 *   79h productive, 0h brainrot  -> 1.00 x 79 = 79.0
 *   79h productive, 20h brainrot -> 0.80 x 79 = 62.4
 *
 * Null only when there's nothing to score at all.
 */
export function workMax(t: BucketTotals): number | null {
  const f = focusScore(t);
  if (f === null) return null;
  return Math.round((f / 100) * t.productive * 10) / 10;
}

/** WorkMax straight from raw hours, for callers that don't build BucketTotals. */
export function workMaxFrom(productive: number, brainrot: number): number | null {
  const scored = productive + brainrot;
  if (scored === 0) return null;
  return Math.round((productive / scored) * productive * 10) / 10;
}

/** ISO date of the Monday of the week containing `date`. */
export function weekStart(dateISO: string): string {
  const d = new Date(dateISO + "T00:00:00");
  const day = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface RankingRow {
  period: "day" | "week" | "all";
  totals: BucketTotals;
  ratio: number | null;
  score: number | null;
}

/**
 * Compute ranking rows for one user from entries, relative to `todayISO`.
 * Shows both productive hours and the ratio so neither stat can be gamed alone.
 */
export function computeRanking(entries: DayEntry[], settings: BucketSettings, todayISO: string): RankingRow[] {
  const ws = weekStart(todayISO);
  const dayEntries = entries.filter((e) => e.date === todayISO);
  const weekEntries = entries.filter((e) => e.date >= ws && e.date <= todayISO);

  const mk = (period: RankingRow["period"], list: DayEntry[]): RankingRow => {
    const totals = bucketize(hoursByCategory(list), settings);
    return { period, totals, ratio: productiveRatio(totals), score: focusScore(totals) };
  };
  return [mk("day", dayEntries), mk("week", weekEntries), mk("all", entries)];
}
