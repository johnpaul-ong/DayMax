"use client";

/**
 * Quick Capture — the answer to the biggest problem with this app.
 *
 * Logging 96 slots a day is ~10 minutes of data entry, and that burden is the
 * main reason a tracker gets abandoned. Capture flips it: instead of sitting
 * down to fill in a grid, a small box asks "what are you doing?" as each
 * 15-minute slot closes. Type three words, hit Enter, done — and if you've been
 * away an hour it queues the four missed slots so you clear them in four
 * keystrokes rather than hunting for them on a month grid.
 *
 * The logic here is deliberately pure and separate from the widget so it can be
 * unit-tested — see __tests__/capture.test.ts.
 */

import { SLOTS_PER_DAY } from "./categories";
import type { DayEntry } from "./types";

export interface CaptureSettings {
  enabled: boolean;
  /** How far back to offer catch-up slots, in minutes. */
  lookbackMin: number;
  /** Never queue more than this at once — a wall of 40 boxes is a closed tab. */
  maxQueue: number;
  /** No prompting between these hours (local, 0-23). Sleep is not interesting. */
  quietFrom: number;
  quietTo: number;
  /** Desktop notifications when the tab isn't focused. */
  notify: boolean;
}

export const DEFAULT_CAPTURE: CaptureSettings = {
  enabled: true,
  lookbackMin: 120,
  maxQueue: 8,
  quietFrom: 22,
  quietTo: 7,
  notify: false,
};

const KEY = "daymax-capture";
const SNOOZE_KEY = "daymax-capture-snooze";

export function loadCaptureSettings(): CaptureSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_CAPTURE, ...JSON.parse(raw) } : { ...DEFAULT_CAPTURE };
  } catch {
    return { ...DEFAULT_CAPTURE };
  }
}

export function saveCaptureSettings(s: CaptureSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    window.dispatchEvent(new Event("daymax-capture-changed"));
  } catch {}
}

/** Snooze is a timestamp, so it survives a reload but not a new day. */
export function snoozeUntil(ms: number) {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + ms));
  } catch {}
}

export function isSnoozed(): boolean {
  try {
    const v = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
    return Number.isFinite(v) && v > Date.now();
  } catch {
    return false;
  }
}

export function clearSnooze() {
  try {
    localStorage.removeItem(SNOOZE_KEY);
  } catch {}
}

/** Slot index for a local time. 0 = 00:00-00:15, 95 = 23:45-24:00. */
export function slotForTime(d: Date = new Date()): number {
  return Math.min(SLOTS_PER_DAY - 1, d.getHours() * 4 + Math.floor(d.getMinutes() / 15));
}

/** Quiet hours wrap midnight, so 22->7 means "22:00 through 06:59". */
export function inQuietHours(hour: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/**
 * Which slots to ask about, oldest first.
 *
 * Only slots that are BOTH already finished and still empty. The lookback stops
 * it asking about your whole morning when you open the app at 5pm, and maxQueue
 * stops a long absence producing an intimidating pile.
 */
export function buildQueue(opts: {
  filledSlots: Set<number>;
  nowSlot: number;
  lookbackSlots: number;
  maxQueue: number;
  skipped?: Set<number>;
}): number[] {
  const { filledSlots, nowSlot, lookbackSlots, maxQueue, skipped } = opts;
  const start = Math.max(0, nowSlot - lookbackSlots);
  const out: number[] = [];
  // nowSlot itself is still in progress — asking about it is asking the future
  for (let s = start; s < nowSlot; s++) {
    if (filledSlots.has(s)) continue;
    if (skipped?.has(s)) continue;
    out.push(s);
  }
  // when there's a backlog, the most recent slots are the ones you can still
  // remember, so keep the tail rather than the head
  return out.slice(-maxQueue);
}

// --- label memory -------------------------------------------------------------

export interface LabelMemory {
  /** normalized label -> the category you most often paired it with */
  category: Map<string, number>;
  /** original casing + frequency, most-used first, for autocomplete */
  suggestions: Array<{ label: string; category: number; count: number }>;
}

export function normalizeLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Learn "email" -> Work from the user's own history, so typing a few words is
 * enough and they never touch the category picker for a routine activity.
 */
export function learnLabels(entries: Array<Pick<DayEntry, "category" | "label">>): LabelMemory {
  const counts = new Map<string, Map<number, number>>();
  const display = new Map<string, string>();
  for (const e of entries) {
    if (!e.label) continue;
    const k = normalizeLabel(e.label);
    if (!k) continue;
    if (!counts.has(k)) counts.set(k, new Map());
    const byCat = counts.get(k)!;
    byCat.set(e.category, (byCat.get(e.category) ?? 0) + 1);
    if (!display.has(k)) display.set(k, e.label.trim());
  }

  const category = new Map<string, number>();
  const suggestions: LabelMemory["suggestions"] = [];
  for (const [k, byCat] of counts) {
    let bestCat = 0;
    let bestN = -1;
    let total = 0;
    for (const [c, n] of byCat) {
      total += n;
      if (n > bestN) {
        bestN = n;
        bestCat = c;
      }
    }
    category.set(k, bestCat);
    suggestions.push({ label: display.get(k) ?? k, category: bestCat, count: total });
  }
  suggestions.sort((a, b) => b.count - a.count);
  return { category, suggestions };
}

/**
 * Best category for what's being typed: exact match first, then a unique
 * prefix match. Ambiguous prefixes return null rather than guessing wrong —
 * a wrong silent category is worse than asking.
 */
export function guessCategory(label: string, mem: LabelMemory): number | null {
  const k = normalizeLabel(label);
  if (!k) return null;
  const exact = mem.category.get(k);
  if (exact !== undefined) return exact;

  const hits = mem.suggestions.filter((s) => normalizeLabel(s.label).startsWith(k));
  if (hits.length === 0) return null;
  const first = hits[0].category;
  return hits.every((h) => h.category === first) ? first : null;
}

/** Autocomplete candidates for what's typed so far. */
export function suggestLabels(label: string, mem: LabelMemory, n = 6) {
  const k = normalizeLabel(label);
  if (!k) return mem.suggestions.slice(0, n);
  return mem.suggestions
    .filter((s) => normalizeLabel(s.label).includes(k))
    .slice(0, n);
}
