"use client";

/**
 * Insights: the correlation engine, but in sentences.
 *
 * /overview already computes this stuff and renders it as scatter plots that
 * nobody reads. A scatter plot is evidence; a sentence is a finding. "You sleep
 * 41 minutes less on gym days" is the thing someone screenshots and sends to a
 * friend — the app's only organic distribution.
 *
 * Rules I've tried to hold to:
 *   - Never claim causation. "on days when", not "because".
 *   - Refuse to speak on thin data. Every generator has a minimum sample and
 *     returns nothing below it. A confident lie is worse than silence.
 *   - Only surface a difference big enough to act on.
 */

import { HOURS_PER_SLOT } from "./categories";
import { weekStart } from "./ranking";

export interface Insight {
  /** For ordering: how interesting this is, 0-1. */
  strength: number;
  text: string;
  /** Shown small, so the claim can be checked. */
  basis: string;
}

export interface DayFacts {
  date: string;
  productive: number;
  brainrot: number;
  social: number;
  other: number;
  /** Optional day metrics, when the user logs them. */
  emotional?: number | null;
  tired?: number | null;
  slots?: number;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function fmtHours(h: number): string {
  const m = Math.round(h * 60);
  if (m < 60) return `${m} minutes`;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${hh} hour${hh === 1 ? "" : "s"}` : `${hh}h ${mm}m`;
}

/** Your best and worst weekday, if the gap is worth mentioning. */
function bestWeekday(days: DayFacts[]): Insight | null {
  if (days.length < 21) return null;
  const byDow = new Map<number, number[]>();
  for (const d of days) {
    const dow = new Date(d.date + "T00:00:00").getDay();
    byDow.set(dow, [...(byDow.get(dow) ?? []), d.productive]);
  }
  const scored = [...byDow.entries()]
    .filter(([, xs]) => xs.length >= 3)
    .map(([dow, xs]) => ({ dow, avg: mean(xs), n: xs.length }))
    .sort((a, b) => b.avg - a.avg);
  if (scored.length < 3) return null;
  const top = scored[0];
  const bottom = scored[scored.length - 1];
  const gap = top.avg - bottom.avg;
  if (gap < 1) return null; // less than an hour isn't a pattern, it's noise
  return {
    strength: Math.min(1, gap / 4),
    text: `${WEEKDAYS[top.dow]}s are your best day — ${fmtHours(gap)} more productive than ${WEEKDAYS[bottom.dow]}s.`,
    basis: `${top.n} ${WEEKDAYS[top.dow]}s vs ${bottom.n} ${WEEKDAYS[bottom.dow]}s`,
  };
}

/** What a brainrot-heavy day does to the day AFTER it. */
function brainrotHangover(days: DayFacts[]): Insight | null {
  if (days.length < 21) return null;
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  const median = [...sorted.map((d) => d.brainrot)].sort((a, b) => a - b)[Math.floor(sorted.length / 2)];
  const after: { high: number[]; low: number[] } = { high: [], low: [] };
  for (let i = 0; i < sorted.length - 1; i++) {
    const next = sorted[i + 1];
    // only compare consecutive calendar days
    const gapDays = (new Date(next.date + "T00:00:00").getTime() - new Date(sorted[i].date + "T00:00:00").getTime()) / 86400000;
    if (gapDays !== 1) continue;
    (sorted[i].brainrot > median ? after.high : after.low).push(next.productive);
  }
  if (after.high.length < 5 || after.low.length < 5) return null;
  const diff = mean(after.low) - mean(after.high);
  if (Math.abs(diff) < 0.75) return null;
  return {
    strength: Math.min(1, Math.abs(diff) / 3),
    text:
      diff > 0
        ? `The day after a heavy brainrot day, you get ${fmtHours(diff)} less done.`
        : `Odd one: you're ${fmtHours(-diff)} more productive the day after a heavy brainrot day.`,
    basis: `${after.high.length} heavy days vs ${after.low.length} light ones`,
  };
}

/** Does training track with mood? Uses the Sports bucket via `social`-free totals. */
function moodAndProductivity(days: DayFacts[]): Insight | null {
  const withMood = days.filter((d) => typeof d.emotional === "number");
  if (withMood.length < 14) return null;
  const median = [...withMood.map((d) => d.emotional as number)].sort((a, b) => a - b)[Math.floor(withMood.length / 2)];
  const good = withMood.filter((d) => (d.emotional as number) > median).map((d) => d.productive);
  const bad = withMood.filter((d) => (d.emotional as number) <= median).map((d) => d.productive);
  if (good.length < 5 || bad.length < 5) return null;
  const diff = mean(good) - mean(bad);
  if (Math.abs(diff) < 0.75) return null;
  return {
    strength: Math.min(1, Math.abs(diff) / 3),
    text:
      diff > 0
        ? `On your better-mood days you get ${fmtHours(diff)} more done.`
        : `You actually get ${fmtHours(-diff)} more done on your low-mood days.`,
    basis: `${good.length} good days vs ${bad.length} rough ones`,
  };
}

/** Weekend vs weekday, which most people are wrong about. */
function weekendGap(days: DayFacts[]): Insight | null {
  if (days.length < 14) return null;
  const we: number[] = [];
  const wd: number[] = [];
  for (const d of days) {
    const dow = new Date(d.date + "T00:00:00").getDay();
    (dow === 0 || dow === 6 ? we : wd).push(d.productive);
  }
  if (we.length < 4 || wd.length < 8) return null;
  const diff = mean(wd) - mean(we);
  if (Math.abs(diff) < 1) return null;
  return {
    strength: Math.min(1, Math.abs(diff) / 5),
    text:
      diff > 0
        ? `Weekends cost you ${fmtHours(diff)} of productive time a day versus weekdays.`
        : `You're ${fmtHours(-diff)} more productive at weekends than on weekdays.`,
    basis: `${we.length} weekend days, ${wd.length} weekdays`,
  };
}

/** Is this week better or worse than your recent average? */
function thisWeekTrend(days: DayFacts[], todayISO: string): Insight | null {
  if (days.length < 14) return null;
  const ws = weekStart(todayISO);
  const thisWeek = days.filter((d) => d.date >= ws && d.date <= todayISO);
  const before = days.filter((d) => d.date < ws);
  if (thisWeek.length < 2 || before.length < 7) return null;
  const diff = mean(thisWeek.map((d) => d.productive)) - mean(before.map((d) => d.productive));
  if (Math.abs(diff) < 0.5) return null;
  return {
    strength: Math.min(1, Math.abs(diff) / 3) * 0.9,
    text:
      diff > 0
        ? `This week is running ${fmtHours(diff)} a day above your average.`
        : `This week is running ${fmtHours(-diff)} a day below your average.`,
    basis: `${thisWeek.length} days so far vs your previous ${before.length}`,
  };
}

/** Your single most productive day on record — a small trophy. */
function personalBest(days: DayFacts[]): Insight | null {
  if (days.length < 10) return null;
  const best = [...days].sort((a, b) => b.productive - a.productive)[0];
  if (!best || best.productive < 2) return null;
  const avg = mean(days.map((d) => d.productive));
  if (best.productive < avg * 1.5) return null;
  return {
    strength: 0.4,
    text: `Your best day was ${best.date} — ${fmtHours(best.productive)} productive, ${Math.round(
      (best.productive / Math.max(avg, 0.01) - 1) * 100
    )}% above your average.`,
    basis: `across ${days.length} logged days`,
  };
}

/**
 * All the insights worth showing, strongest first.
 * Returns an empty array on thin data rather than padding with weak claims.
 */
export function buildInsights(days: DayFacts[], todayISO: string, limit = 4): Insight[] {
  const generators = [bestWeekday, brainrotHangover, moodAndProductivity, weekendGap, personalBest];
  const found: Insight[] = [];
  for (const g of generators) {
    const i = g(days);
    if (i) found.push(i);
  }
  const trend = thisWeekTrend(days, todayISO);
  if (trend) found.push(trend);
  return found.sort((a, b) => b.strength - a.strength).slice(0, limit);
}

/** Turn raw day totals into the shape the generators want. */
export function factsFromTotals(
  totals: Array<{ date: string; productive: number; brainrot: number; social: number; other: number }>,
  metrics?: Array<{ date: string; emotionalScore: number | null; tired: number | null }>
): DayFacts[] {
  const byDate = new Map(metrics?.map((m) => [m.date, m]) ?? []);
  return totals.map((t) => ({
    ...t,
    emotional: byDate.get(t.date)?.emotionalScore ?? null,
    tired: byDate.get(t.date)?.tired ?? null,
  }));
}

export { HOURS_PER_SLOT };
