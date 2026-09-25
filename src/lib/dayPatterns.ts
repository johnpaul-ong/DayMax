/**
 * Time-of-day patterns from one person's 15-minute slots — "you're most
 * productive 9am–11am", "you switch activities most 4pm–6pm". Pure, so it is
 * pinned by src/lib/__tests__/dayPatterns.test.ts.
 *
 * PRIVACY: computed in the viewer's browser from member_day_strip, which only
 * returns a person's slots if they share their day detail with that viewer
 * (profile visibility + the "days" section). So a pattern is only ever shown
 * to someone who could already see the day it came from. Labels are never
 * read. Wording is neutral because it appears on other people's cards too.
 *
 * Only days with at least half the day logged count: a day with three slots
 * painted would otherwise make 9am look like your "most productive" hour.
 */

import { defaultBuckets, SLOTS_PER_DAY, type Bucket } from "./categories";

export interface SlotRow {
  date: string;
  slot: number;
  category: number;
}

export interface Pattern {
  kind: "peak_productive" | "focus_block" | "switching" | "social" | "brainrot" | "wake";
  text: string;
}

const SLEEP = 0;
const SOCIAL = 3;
const MIN_SLOTS_PER_DAY = SLOTS_PER_DAY / 2;
export const MIN_DAYS = 3;
const WINDOW = 8; // 2 hours of 15-minute slots

function clock(slot: number): string {
  const h = Math.floor(slot / 4) % 24;
  const m = (slot % 4) * 15;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "am" : "pm";
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function span(startSlot: number): string {
  return `${clock(startSlot)}–${clock(startSlot + WINDOW)}`;
}

function duration(slots: number): string {
  const mins = Math.round(slots * 15);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Hour-aligned 2-hour window with the highest per-day average of `score`. */
function bestWindow(days: (number | null)[][], score: (cat: number) => number): { start: number; perDay: number } {
  let best = { start: 0, perDay: -1 };
  for (let start = 0; start + WINDOW <= SLOTS_PER_DAY; start += 4) {
    let total = 0;
    for (const d of days) for (let s = start; s < start + WINDOW; s++) if (d[s] != null) total += score(d[s]!);
    const perDay = total / days.length;
    if (perDay > best.perDay) best = { start, perDay };
  }
  return best;
}

export function dayPatterns(rows: SlotRow[], buckets: Record<number, Bucket> = defaultBuckets()): Pattern[] {
  const byDate = new Map<string, (number | null)[]>();
  for (const r of rows) {
    if (r.slot < 0 || r.slot >= SLOTS_PER_DAY) continue;
    if (!byDate.has(r.date)) byDate.set(r.date, new Array(SLOTS_PER_DAY).fill(null));
    byDate.get(r.date)![r.slot] = r.category;
  }
  const dates = [...byDate.keys()].sort();
  const days = dates
    .map((d) => byDate.get(d)!)
    .filter((d) => d.filter((c) => c != null).length >= MIN_SLOTS_PER_DAY);
  if (days.length < MIN_DAYS) return [];

  const productive = (c: number) => (buckets[c] === "productive" ? 1 : 0);
  const brainrot = (c: number) => (buckets[c] === "brainrot" ? 1 : 0);
  const out: Pattern[] = [];

  const peak = bestWindow(days, productive);
  if (peak.perDay >= 2) {
    out.push({
      kind: "peak_productive",
      text: `Most productive ${span(peak.start)}: ${duration(peak.perDay)} of work or sport in those two hours on a typical day.`,
    });
  }

  // Longest unbroken productive run, overall and on a typical day.
  const longest = days.map((d) => {
    let best = 0;
    let run = 0;
    for (const c of d) {
      run = c != null && productive(c) ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return best;
  });
  const top = Math.max(...longest);
  if (top >= 4) {
    const sorted = [...longest].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    out.push({
      kind: "focus_block",
      text:
        median === top
          ? `Longest unbroken productive block: ${duration(top)}, and a block that long on most days.`
          : `Longest unbroken productive block: ${duration(top)}; a typical day's best was ${duration(median)}.`,
    });
  }

  // Switches: consecutive logged slots with different categories, sleep excluded.
  const switchesAt = (d: (number | null)[], s: number) =>
    s > 0 && d[s] != null && d[s - 1] != null && d[s] !== d[s - 1] && d[s] !== SLEEP && d[s - 1] !== SLEEP ? 1 : 0;
  let bestSw = { start: 0, perDay: -1 };
  let awakeSlots = 0;
  let allSwitches = 0;
  for (const d of days) {
    for (let s = 0; s < SLOTS_PER_DAY; s++) {
      if (d[s] != null && d[s] !== SLEEP) awakeSlots++;
      allSwitches += switchesAt(d, s);
    }
  }
  for (let start = 0; start + WINDOW <= SLOTS_PER_DAY; start += 4) {
    let n = 0;
    for (const d of days) for (let s = start; s < start + WINDOW; s++) n += switchesAt(d, s);
    const perDay = n / days.length;
    if (perDay > bestSw.perDay) bestSw = { start, perDay };
  }
  if (bestSw.perDay >= 2 && awakeSlots > 0) {
    const baseline = (allSwitches / awakeSlots) * WINDOW;
    out.push({
      kind: "switching",
      text:
        `Switched activities most around ${span(bestSw.start)}: about ${Math.round(bestSw.perDay)} changes in those two hours on a typical day` +
        (baseline > 0 && bestSw.perDay >= baseline * 1.5
          ? `, versus about ${Math.max(1, Math.round(baseline))} per two hours across the rest of the waking day.`
          : "."),
    });
  }

  const social = bestWindow(days, (c) => (c === SOCIAL ? 1 : 0));
  if (social.perDay >= 1.5) {
    out.push({
      kind: "social",
      text: `Most social around ${span(social.start)}: ${duration(social.perDay)} of social time in that window on average.`,
    });
  }

  const rot = bestWindow(days, brainrot);
  if (rot.perDay >= 1.5) {
    out.push({
      kind: "brainrot",
      text: `Brainrot peaked around ${span(rot.start)}: ${duration(rot.perDay)} a day in that window on average.`,
    });
  }

  // Wake time: first non-sleep slot on days that start asleep and wake before 2pm.
  const wakes = days
    .filter((d) => d[0] === SLEEP)
    .map((d) => d.findIndex((c) => c != null && c !== SLEEP))
    .filter((s) => s > 0 && s < 56)
    .sort((a, b) => a - b);
  if (wakes.length >= MIN_DAYS) {
    out.push({
      kind: "wake",
      text: `Typically up around ${clock(wakes[Math.floor(wakes.length / 2)])}.`,
    });
  }

  return out;
}
