"use client";

/**
 * Streaks and daily completion — the feedback loop the app didn't have.
 *
 * A tracker with no sense of "am I keeping this up?" is a tracker people use
 * for nine days. Everything here is derived from data that already exists; no
 * schema, no extra writes.
 *
 * Deliberate design choice: a day counts as logged at a THRESHOLD, not at 96/96.
 * Demanding a perfect day makes the streak unachievable, and an unachievable
 * streak is worse than none — the first miss makes you quit.
 *
 * The bar is half the day (48 of 96 slots, 12 hours). It's a number you can
 * hold in your head, and it's reachable whether or not you bother logging
 * sleep. An earlier draft used 60%, which works out at 14.5 hours — fine if you
 * log every night, impossible if you don't.
 */

import { SLOTS_PER_DAY } from "./categories";

/** Slots that must be filled before a day "counts": half of them, 12 hours. */
export const DAY_COMPLETE_SLOTS = Math.round(SLOTS_PER_DAY * 0.5);

export interface DayCompletion {
  date: string;
  slots: number;
  complete: boolean;
}

export interface StreakSummary {
  /** Consecutive complete days ending today (or yesterday, if today is young). */
  current: number;
  longest: number;
  /** Complete days in the last 7 and 30 days. */
  last7: number;
  last30: number;
  /** Slots filled today, 0-96. */
  todaySlots: number;
  todayPercent: number;
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Slots filled per day, from raw entries. */
export function completionByDate(entries: Array<{ date: string }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.date, (m.get(e.date) ?? 0) + 1);
  return m;
}

/**
 * Today is excluded from breaking a streak until it's actually complete —
 * otherwise your streak reads 0 every morning before you've logged anything,
 * which is exactly the wrong message at exactly the wrong moment.
 */
export function summarise(byDate: Map<string, number>, todayISO: string, threshold = DAY_COMPLETE_SLOTS): StreakSummary {
  const complete = (iso: string) => (byDate.get(iso) ?? 0) >= threshold;

  let current = 0;
  let cursor = complete(todayISO) ? todayISO : addDays(todayISO, -1);
  while (complete(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }

  // longest: walk the sorted set of complete days looking for adjacency
  const days = [...byDate.entries()]
    .filter(([, n]) => n >= threshold)
    .map(([d]) => d)
    .sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }

  const within = (n: number) => {
    const from = addDays(todayISO, -n + 1);
    return days.filter((d) => d >= from && d <= todayISO).length;
  };

  const todaySlots = byDate.get(todayISO) ?? 0;
  return {
    current,
    longest,
    last7: within(7),
    last30: within(30),
    todaySlots,
    todayPercent: Math.round((todaySlots / SLOTS_PER_DAY) * 100),
  };
}

/** A short, honest nudge. Null when there's nothing worth saying. */
export function streakMessage(s: StreakSummary): string | null {
  if (s.current >= 2 && s.todaySlots < DAY_COMPLETE_SLOTS) {
    return `${s.current}-day streak — today needs ${DAY_COMPLETE_SLOTS - s.todaySlots} more slots to keep it.`;
  }
  if (s.current >= 2) return `${s.current} days running.`;
  if (s.current === 1) return "Day one. Again tomorrow.";
  if (s.last30 > 0) return `Last complete day was a while ago — ${s.last30} in the past month.`;
  return null;
}
