"use client";

/**
 * The Quick Capture box.
 *
 * Design rules, in priority order:
 *   1. Enter must be enough. Type words, press Enter, it saves and advances to
 *      the next unfilled slot. No mouse, no category picker for anything you've
 *      logged before.
 *   2. Never trap the user. Esc skips one, "Later" snoozes, "Not today" stops
 *      until tomorrow. All one click, all obvious.
 *   3. Never nag. Quiet hours, a lookback limit, and a queue cap mean it can't
 *      greet you with forty boxes after a weekend away.
 *
 * Mounted globally in layout.tsx, so it works from whatever page you're on.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, categoryColor, categoryName, slotToTime } from "@/lib/categories";
import { fetchDayEntries, upsertDayEntries } from "@/lib/data";
import { localToday } from "@/lib/dates";
import {
  buildQueue,
  clearSnooze,
  guessCategory,
  inQuietHours,
  isSnoozed,
  learnLabels,
  loadCaptureSettings,
  slotForTime,
  snoozeUntil,
  suggestLabels,
  type CaptureSettings,
  type LabelMemory,
} from "@/lib/capture";

const EMPTY_MEMORY: LabelMemory = { category: new Map(), suggestions: [] };

export default function CaptureWidget() {
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<number[]>([]);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [filled, setFilled] = useState<Set<number>>(new Set());
  const [memory, setMemory] = useState<LabelMemory>(EMPTY_MEMORY);
  const [label, setLabel] = useState("");
  const [cat, setCat] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState<number | null>(null);
  const [lastEntry, setLastEntry] = useState<{ category: number; label: string | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const date = localToday();

  // --- load settings, and react to Settings changing them ---------------------
  useEffect(() => {
    const read = () => setSettings(loadCaptureSettings());
    read();
    window.addEventListener("daymax-capture-changed", read);
    return () => window.removeEventListener("daymax-capture-changed", read);
  }, []);

  // --- today's entries: what's filled, and what you usually call things -------
  const refresh = useCallback(async () => {
    try {
      const today = await fetchDayEntries(date, date);
      setFilled(new Set(today.map((e) => e.slot)));
      const sorted = [...today].sort((a, b) => b.slot - a.slot);
      setLastEntry(sorted[0] ? { category: sorted[0].category, label: sorted[0].label } : null);
    } catch {
      // offline or signed out — stay quiet rather than popping an error box
    }
  }, [date]);

  useEffect(() => {
    if (!settings?.enabled) return;
    void refresh();
    // 60 days of history is plenty to learn someone's vocabulary and stays small
    const from = new Date();
    from.setDate(from.getDate() - 60);
    fetchDayEntries(localToday(from), date)
      .then((es) => setMemory(learnLabels(es)))
      .catch(() => {});
  }, [settings?.enabled, refresh, date]);

  // --- the tick: recompute the queue every 30s --------------------------------
  useEffect(() => {
    if (!settings?.enabled) return;
    const tick = () => {
      const now = new Date();
      if (inQuietHours(now.getHours(), settings.quietFrom, settings.quietTo)) return setQueue([]);
      if (isSnoozed()) return setQueue([]);
      const q = buildQueue({
        filledSlots: filled,
        nowSlot: slotForTime(now),
        lookbackSlots: Math.round(settings.lookbackMin / 15),
        maxQueue: settings.maxQueue,
        skipped,
      });
      setQueue(q);
      if (q.length > 0) setOpen(true);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [settings, filled, skipped]);

  // --- desktop notification when the tab is in the background -----------------
  const notified = useRef<number | null>(null);
  useEffect(() => {
    if (!settings?.notify || queue.length === 0) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;
    const newest = queue[queue.length - 1];
    if (notified.current === newest) return; // one ping per slot, not per tick
    notified.current = newest;
    try {
      new Notification("DayMax", {
        body: queue.length === 1 ? `What were you doing at ${slotToTime(newest)}?` : `${queue.length} slots to fill in`,
        tag: "daymax-capture",
      });
    } catch {}
  }, [queue, settings?.notify]);

  // --- hotkey: Ctrl/Cmd+J opens the box and focuses the field -----------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        clearSnooze();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = queue[0] ?? null;
  const guessed = useMemo(() => guessCategory(label, memory), [label, memory]);
  const effectiveCat = cat ?? guessed ?? lastEntry?.category ?? null;
  const hints = useMemo(() => suggestLabels(label, memory, 5), [label, memory]);

  // focus whenever a new slot comes up, so a queue is pure typing
  useEffect(() => {
    if (open && current !== null) inputRef.current?.focus();
  }, [open, current]);

  async function save(useCat: number | null, useLabel: string) {
    if (current === null || useCat === null) return;
    setSaving(true);
    try {
      await upsertDayEntries([{ date, slot: current, category: useCat, label: useLabel.trim() || null }]);
      setFilled((prev) => new Set(prev).add(current));
      setJustSaved(current);
      setTimeout(() => setJustSaved(null), 1200);
      setLabel("");
      setCat(null);
      setLastEntry({ category: useCat, label: useLabel.trim() || null });
    } catch {
      // leave it in the queue — better to retry than to silently lose it
    } finally {
      setSaving(false);
    }
  }

  function skipOne() {
    if (current === null) return;
    setSkipped((prev) => new Set(prev).add(current));
    setLabel("");
    setCat(null);
  }

  function fillRestWithSame() {
    if (!lastEntry) return;
    const all = queue;
    setSaving(true);
    upsertDayEntries(all.map((s) => ({ date, slot: s, category: lastEntry.category, label: lastEntry.label })))
      .then(() => setFilled((prev) => new Set([...prev, ...all])))
      .catch(() => {})
      .finally(() => setSaving(false));
  }

  if (!settings?.enabled || !open || current === null) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 sm:inset-x-auto sm:right-4 sm:w-[26rem]">
      <div className="card border-2 border-accent-soft p-4 shadow-lg">
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">
            {slotToTime(current)}–{slotToTime(current + 1)}
          </h2>
          <span className="text-xs text-muted">what were you doing?</span>
          {queue.length > 1 && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted">
              {queue.length} to go
            </span>
          )}
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="ml-auto text-lg leading-none text-faint hover:text-ink"
          >
            ×
          </button>
        </div>

        <input
          ref={inputRef}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && effectiveCat !== null) {
              e.preventDefault();
              void save(effectiveCat, label);
            } else if (e.key === "Escape") {
              e.preventDefault();
              skipOne();
            } else if (e.key === "ArrowUp" && !label && lastEntry) {
              // repeat the previous slot without typing
              e.preventDefault();
              setLabel(lastEntry.label ?? "");
              setCat(lastEntry.category);
            }
          }}
          placeholder={lastEntry?.label ? `e.g. ${lastEntry.label} — ↑ to repeat` : "a few words…"}
          list="daymax-capture-hints"
          className="w-full rounded-lg border bg-surface px-3 py-2 text-sm"
        />
        <datalist id="daymax-capture-hints">
          {hints.map((h) => (
            <option key={h.label} value={h.label} />
          ))}
        </datalist>

        <div className="mt-2 flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.code}
              onClick={() => setCat(c.code)}
              title={c.name}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                effectiveCat === c.code ? "text-white" : "bg-surface-2 text-muted hover:text-ink"
              }`}
              style={effectiveCat === c.code ? { background: categoryColor(c.code) } : undefined}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void save(effectiveCat, label)}
            disabled={saving || effectiveCat === null}
            className="btn-primary py-1"
          >
            {saving ? "…" : "Save ⏎"}
          </button>
          <button onClick={skipOne} className="btn-ghost py-1 text-xs">Skip</button>
          {queue.length > 1 && lastEntry && (
            <button onClick={fillRestWithSame} className="btn-ghost py-1 text-xs">
              All {queue.length} as &ldquo;{lastEntry.label || categoryName(lastEntry.category)}&rdquo;
            </button>
          )}
          <span className="ml-auto flex gap-2 text-xs">
            <button
              onClick={() => {
                snoozeUntil(60 * 60 * 1000);
                setOpen(false);
              }}
              className="text-muted hover:text-accent"
            >
              Later
            </button>
            <button
              onClick={() => {
                snoozeUntil(24 * 60 * 60 * 1000);
                setOpen(false);
              }}
              className="text-muted hover:text-danger"
            >
              Not today
            </button>
          </span>
        </div>

        <p className="mt-2 text-[10px] text-faint">
          {justSaved !== null ? (
            <span className="text-ok">Saved {slotToTime(justSaved)} ✓</span>
          ) : (
            <>⌘/Ctrl+J anywhere · Enter saves · Esc skips{effectiveCat !== null && guessed !== null && cat === null && <> · category guessed from your history</>}</>
          )}
        </p>
      </div>
    </div>
  );
}
