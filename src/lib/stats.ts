/**
 * Small stats helpers for the Overview page: time aggregation and
 * Pearson correlation for the "is tired killing my productivity?" charts.
 */

import type { BucketSettings, BucketTotals, DayEntry, DayMetrics } from "./types";
import { bucketize, hoursByCategory, weekStart } from "./ranking";

export type Period = "day" | "week" | "month";

export interface PeriodBuckets extends BucketTotals {
  label: string; // "08-15", "W 08-10", "2026-08"
  days: number;
}

export function periodKey(dateISO: string, period: Period): string {
  if (period === "day") return dateISO;
  if (period === "week") return weekStart(dateISO);
  return dateISO.slice(0, 7);
}

export function bucketsByPeriod(entries: DayEntry[], settings: BucketSettings, period: Period): PeriodBuckets[] {
  const byKey = new Map<string, DayEntry[]>();
  const daysPerKey = new Map<string, Set<string>>();
  for (const e of entries) {
    const k = periodKey(e.date, period);
    byKey.set(k, [...(byKey.get(k) ?? []), e]);
    if (!daysPerKey.has(k)) daysPerKey.set(k, new Set());
    daysPerKey.get(k)!.add(e.date);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, list]) => {
      const t = bucketize(hoursByCategory(list), settings);
      const label = period === "day" ? k.slice(5) : period === "week" ? `W ${k.slice(5)}` : k;
      return { label, days: daysPerKey.get(k)!.size, ...t };
    });
}

/** Pearson correlation coefficient; null if fewer than 3 points or zero variance. */
export function pearson(pairs: Array<[number, number]>): number | null {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export function describeR(r: number): string {
  const a = Math.abs(r);
  const strength = a >= 0.7 ? "strong" : a >= 0.4 ? "moderate" : a >= 0.2 ? "weak" : "no real";
  const dir = r > 0 ? "positive" : "negative";
  return a < 0.2 ? "no real correlation" : `${strength} ${dir} correlation`;
}

/** Values selectable on the correlation axes, computed per day. */
export interface DayPoint {
  date: string;
  [key: string]: number | string | null;
}

export function buildDayPoints(entries: DayEntry[], metrics: DayMetrics[], settings: BucketSettings): DayPoint[] {
  const byDate = new Map<string, DayEntry[]>();
  for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const metByDate = new Map(metrics.map((m) => [m.date, m]));
  const dates = [...new Set([...byDate.keys(), ...metByDate.keys()])].sort();
  return dates.map((date) => {
    const list = byDate.get(date) ?? [];
    const catHours = hoursByCategory(list);
    const t = bucketize(catHours, settings);
    const m = metByDate.get(date);
    return {
      date,
      productive: list.length ? t.productive : null,
      brainrot: list.length ? t.brainrot : null,
      sleep: catHours[0] ?? (list.length ? 0 : null),
      emotionalScore: m?.emotionalScore ?? null,
      tired: m?.tired ?? null,
      startFriction: m?.startFriction ?? null,
      endBrainFatigue: m?.endBrainFatigue ?? null,
      weightKg: m?.weightKg ?? null,
    };
  });
}

export const CORRELATION_FIELDS: Array<{ key: string; label: string }> = [
  { key: "productive", label: "Productive hours" },
  { key: "brainrot", label: "Brainrot hours" },
  { key: "sleep", label: "Sleep hours" },
  { key: "emotionalScore", label: "Emotional score" },
  { key: "tired", label: "Tired" },
  { key: "startFriction", label: "Start friction" },
  { key: "endBrainFatigue", label: "End brain fatigue" },
  { key: "weightKg", label: "Bodyweight (kg)" },
];
