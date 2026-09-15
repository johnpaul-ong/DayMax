/**
 * Which days aren't finished.
 *
 * A day is 96 slots. If you've logged 90 of them, the day contributes 22.5
 * hours, not 24 — which is why an "average day" across a year of real logging
 * comes out at 23.1h rather than a clean 24. Nothing is wrong with the maths;
 * the missing 0.9h a day is genuinely unrecorded time. This module finds it and
 * says exactly which days it came from, so it can be filled in rather than
 * quietly averaged away.
 *
 * Pure functions on plain data, so they're testable without a database.
 */

import { HOURS_PER_SLOT, SLOTS_PER_DAY } from "./categories";

export interface DayGap {
  date: string;
  filled: number;
  missing: number;
  /** Contiguous runs of empty slots, as [startSlot, endSlotInclusive]. */
  runs: Array<[number, number]>;
}

export interface GapSummary {
  /** Days in range with at least one empty slot. */
  incompleteDays: number;
  /** Days in range with nothing logged at all. */
  emptyDays: number;
  /** Days that are 96/96. */
  completeDays: number;
  missingHours: number;
  loggedHours: number;
  /** Hours per day you'd see if only logged time is counted. */
  averageLoggedHours: number;
  /** Worst month, as "YYYY-MM", or null when there's nothing to report. */
  worstMonth: string | null;
}

/** Every date from `from` to `to` inclusive. Both ends are local ISO dates. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (d <= end) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Collapse a sorted list of slot indexes into contiguous [start, end] runs. */
export function toRuns(slots: number[]): Array<[number, number]> {
  if (slots.length === 0) return [];
  const sorted = [...slots].sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const s of sorted.slice(1)) {
    if (s === prev + 1) {
      prev = s;
      continue;
    }
    runs.push([start, prev]);
    start = s;
    prev = s;
  }
  runs.push([start, prev]);
  return runs;
}

/**
 * Incomplete days between `from` and `to`, worst first.
 *
 * `minMissing` filters out days that are all but finished — a day missing one
 * 15-minute slot is not worth a row in a spreadsheet.
 */
export function findGaps(
  entries: Array<{ date: string; slot: number }>,
  from: string,
  to: string,
  minMissing = 1
): DayGap[] {
  const byDate = new Map<string, Set<number>>();
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    if (!byDate.has(e.date)) byDate.set(e.date, new Set());
    byDate.get(e.date)!.add(e.slot);
  }

  const gaps: DayGap[] = [];
  for (const date of dateRange(from, to)) {
    const have = byDate.get(date) ?? new Set<number>();
    const missingSlots: number[] = [];
    for (let s = 0; s < SLOTS_PER_DAY; s++) if (!have.has(s)) missingSlots.push(s);
    if (missingSlots.length < minMissing) continue;
    gaps.push({ date, filled: have.size, missing: missingSlots.length, runs: toRuns(missingSlots) });
  }
  return gaps.sort((a, b) => b.missing - a.missing || (a.date < b.date ? -1 : 1));
}

export function summarise(
  entries: Array<{ date: string; slot: number }>,
  from: string,
  to: string
): GapSummary {
  const all = findGaps(entries, from, to, 1);
  const days = dateRange(from, to).length;
  const missingSlots = all.reduce((s, g) => s + g.missing, 0);
  const loggedSlots = days * SLOTS_PER_DAY - missingSlots;

  const byMonth = new Map<string, number>();
  for (const g of all) byMonth.set(g.date.slice(0, 7), (byMonth.get(g.date.slice(0, 7)) ?? 0) + g.missing);
  const worst = [...byMonth.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    incompleteDays: all.length,
    emptyDays: all.filter((g) => g.filled === 0).length,
    completeDays: days - all.length,
    missingHours: Math.round(missingSlots * HOURS_PER_SLOT * 10) / 10,
    loggedHours: Math.round(loggedSlots * HOURS_PER_SLOT * 10) / 10,
    averageLoggedHours: days === 0 ? 0 : Math.round((loggedSlots * HOURS_PER_SLOT * 10) / days) / 10,
    worstMonth: worst ? worst[0] : null,
  };
}
