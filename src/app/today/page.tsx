"use client";

/**
 * Phone-friendly "today" editor: big buttons, no drag needed.
 * Pick a category, tap "from" and "until" times, Fill. Made for
 * "I just woke up, backfill Sleep 00:00–06:30" and gym logging breaks.
 */

import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, categoryColor, slotToTime, SLOTS_PER_DAY } from "@/lib/categories";
import { deleteDayEntries, fetchDayEntries, fetchDayMetrics, upsertDayEntries, upsertDayMetrics } from "@/lib/data";
import type { DayMetrics } from "@/lib/types";
import { localToday } from "@/lib/dates";
import ViewZoom from "../view-zoom";
import DayClock, { type ClockSlot } from "../day-clock";

/** Step a local ISO date by n days without tripping over month ends or DST. */
function shiftDay(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localToday(d);
}

export default function TodayPage() {
  const todayISO = localToday();
  const [date, setDate] = useState(todayISO);
  const [cells, setCells] = useState<Map<number, { category: number; label: string | null }>>(new Map());
  const [cat, setCat] = useState<number>(0);
  const [label, setLabel] = useState("");
  const clockSlots = useMemo(() => {
    const m = new Map<number, ClockSlot>();
    for (const [slot, v] of cells) m.set(slot, { category: v.category, label: v.label });
    return m;
  }, [cells]);

  const [from, setFrom] = useState<number | null>(null);
  const [until, setUntil] = useState<number | null>(null);

  // "You are here" marker on the clock. Only meaningful when the
  // shown date IS today -- looking at yesterday or last Tuesday
  // shouldn't get a live tick. Recomputes every minute so the marker
  // walks across the day as time passes without a page reload.
  const [nowSlot, setNowSlot] = useState<number | null>(() => {
    const n = new Date();
    return date === localToday(n) ? n.getHours() * 4 + Math.floor(n.getMinutes() / 15) : null;
  });
  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setNowSlot(date === localToday(n) ? n.getHours() * 4 + Math.floor(n.getMinutes() / 15) : null);
    };
    tick();
    // 30s tick is plenty -- the slot only changes every 15 min and
    // half-min tick means the halo is never more than a slot off.
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [date]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DayMetrics | null>(null);

  // Category defaults to 0 (a valid code), so "picked" cannot mean
  // "cat != null". It tracks whether the user has actually tapped the
  // picker -- otherwise step 1 lights up before anything has happened.
  const [catPicked, setCatPicked] = useState(false);
  // Step 3 (Fill) is transient: it flashes green after a successful fill
  // and then the whole tracker resets to zero. See fill() below.
  const [justFilled, setJustFilled] = useState(false);
  const hasSelection = from != null && until != null;
  const ready = hasSelection; // cat is always a number, so cat != null is always true
  const step1Done = catPicked;
  const step2Done = hasSelection;
  const step3Done = justFilled;

  useEffect(() => {
    fetchDayEntries(date, date)
      .then((es) => setCells(new Map(es.map((e) => [e.slot, { category: e.category, label: e.label }]))))
      .catch((e) => setError(String(e.message ?? e)));
    fetchDayMetrics(date, date)
      .then((ms) =>
        setMetrics(
          ms[0] ?? {
            date,
            emotionalScore: null,
            tired: null,
            startFriction: null,
            endBrainFatigue: null,
            deepTime: null,
            weightKg: null,
            notes: null,
          }
        )
      )
      .catch(() => {});
  }, [date]);

  const filled = cells.size;

  async function fill(overrideFrom?: number, overrideTo?: number) {
    const a = overrideFrom ?? from;
    const b = overrideTo ?? until;
    if (a == null || b == null) return;
    const [s0, s1] = a <= b ? [a, b] : [b, a];
    setSaving(true);
    setError(null);
    try {
      const entries = [];
      const next = new Map(cells);
      for (let s = s0; s <= s1; s++) {
        const e = { date, slot: s, category: cat, label: label.trim() || null };
        entries.push(e);
        next.set(s, { category: cat, label: e.label });
      }
      setCells(next);
      await upsertDayEntries(entries);
      // Flash step 3 green, then reset the whole tracker: category
      // un-picked, selection cleared, back to a fresh step-1 state.
      setJustFilled(true);
      setTimeout(() => {
        setJustFilled(false);
        setCatPicked(false);
        setFrom(null);
        setUntil(null);
      }, 700);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  async function clearRange() {
    if (from == null || until == null) return;
    const [s0, s1] = from <= until ? [from, until] : [until, from];
    setSaving(true);
    try {
      const slots = [];
      const next = new Map(cells);
      for (let s = s0; s <= s1; s++) {
        slots.push(s);
        next.delete(s);
      }
      setCells(next);
      await deleteDayEntries(date, slots);
      setFrom(null);
      setUntil(null);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  const [metricsSaved, setMetricsSaved] = useState(false);
  // Day metrics collapse closed by default -- they're a "sometimes" input
  // (emotion, tired, deep time), not the main event. Remember the choice
  // per browser so someone who always logs them gets them open next time.
  const [metricsOpen, setMetricsOpen] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("daymax-metrics-open") === "1") setMetricsOpen(true);
    } catch {}
  }, []);

  async function saveMetrics() {
    if (!metrics) return;
    setSaving(true);
    setMetricsSaved(false);
    try {
      await upsertDayMetrics([{ ...metrics, date }]);
      setMetricsSaved(true);
      setTimeout(() => setMetricsSaved(false), 2500);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  // `max` marks a 0-10 judgement, which becomes a slider. Start friction and
  // brain fatigue were unlabelled but are the same kind of thing, so they get
  // the same instrument and finally say what scale they are on.
  const metricFields: Array<{ key: keyof Omit<DayMetrics, "date" | "notes">; label: string; max?: number }> = [
    { key: "emotionalScore", label: "Emotion", max: 10 },
    { key: "tired", label: "Tired", max: 10 },
    { key: "startFriction", label: "Start friction", max: 10 },
    { key: "endBrainFatigue", label: "Brain fatigue", max: 10 },
    { key: "deepTime", label: "Deep time (h)" },
    { key: "weightKg", label: "Weight (kg)" },
  ];

  return (
    <div className="mx-auto max-w-lg">
      <ViewZoom />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">{date === localToday() ? "Today" : "Day"}</h1>
        {/* step a day at a time without opening the picker */}
        <button onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day" className="rounded-lg border px-2.5 py-1 text-sm hover:bg-surface-2">←</button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border px-2 py-1 text-sm" />
        <button
          onClick={() => setDate(shiftDay(date, 1))}
          disabled={date >= localToday()}
          aria-label="Next day"
          className="rounded-lg border px-2.5 py-1 text-sm hover:bg-surface-2 disabled:opacity-35"
        >→</button>
        {date !== localToday() && (
          <button onClick={() => setDate(localToday())} className="text-xs font-medium text-accent hover:underline">today</button>
        )}
        <span className="ml-auto text-sm text-muted">{filled}/96 filled</span>
      </div>

      {error && <p className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="mb-3 grid grid-cols-2 gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c.code}
            onClick={() => { setCat(c.code); setCatPicked(true); }}
            title={`${c.name} — Alt+${c.code}`}
            className={`rounded-lg border px-2 py-2.5 text-left text-sm font-semibold text-ink ${cat === c.code && catPicked ? "ring-2 ring-accent" : ""}`}
            /*
             * c.color is now a CSS var() reference (see lib/categories.ts),
             * so the old `c.color + "22"` string concatenation produced
             * invalid CSS. color-mix() blends the theme variable with
             * transparent at 18%, which works with a var() on the input.
             *
             * Digit codes moved from the visible label to the tooltip
             * so the chips don't read like a numbered list. They stay
             * live as Alt+digit hotkeys.
             */
            style={{
              background: `color-mix(in srgb, ${c.color} 18%, transparent)`,
              borderColor: `color-mix(in srgb, ${c.color} 70%, transparent)`,
            }}
          >
            {c.name}
          </button>
        ))}
      </div>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Optional label (e.g. project, dinner, 5km run)"
        className="mb-3 w-full rounded-lg border px-3 py-2 text-sm"
      />

      {/*
        Numeric FROM -> UNTIL selects, alongside the clock. Two ways in:
        drag on the clock still works (and populates these), but if the
        wedges are too fiddly (Brave has been reported as hard to click
        by hand) or you just want to type in "15:30 -> 15:45" you can
        pick from these dropdowns instead. Both selects list all 96 of
        the day's quarter-hour slots, keyboard-arrow-able and
        touch-friendly.
      */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1 text-xs text-muted">
          from
          <select
            value={from ?? ""}
            onChange={(e) => setFrom(e.target.value === "" ? null : Number(e.target.value))}
            className="rounded-lg border bg-surface px-2 py-1.5 text-sm tabular-nums"
          >
            <option value="">—:—</option>
            {Array.from({ length: SLOTS_PER_DAY }, (_, s) => (
              <option key={s} value={s}>{slotToTime(s)}</option>
            ))}
          </select>
        </label>
        <span aria-hidden="true">→</span>
        <label className="flex items-center gap-1 text-xs text-muted">
          until
          <select
            value={until ?? ""}
            onChange={(e) => setUntil(e.target.value === "" ? null : Number(e.target.value))}
            className="rounded-lg border bg-surface px-2 py-1.5 text-sm tabular-nums"
          >
            <option value="">—:—</option>
            {Array.from({ length: SLOTS_PER_DAY }, (_, s) => (
              // Until reads as an END time — the slot AFTER the last one
              // being filled. Slot 62 fills 15:30 and displays as 15:45
              // in the readout below, so match that with the +1 label.
              <option key={s} value={s}>{slotToTime(Math.min(SLOTS_PER_DAY - 1, s + 1))}</option>
            ))}
          </select>
        </label>
        <button
          onClick={() => void fill()}
          disabled={from == null || until == null || saving}
          className={`ml-auto rounded-lg bg-accent px-4 py-2 font-semibold text-accent-contrast transition disabled:opacity-40 ${
            ready && !saving
              ? "shadow-lg shadow-accent/40 ring-2 ring-accent ring-offset-2 ring-offset-surface animate-pulse"
              : ""
          }`}
        >
          Fill
        </button>
        <button onClick={() => void clearRange()} disabled={from == null || until == null || saving} className="rounded-lg border px-3 py-2 disabled:opacity-40">
          Clear
        </button>
      </div>

      {/* Three-step tracker, always visible. Sits under the from/until
          readout so it's in the same place your eye lands after a drag.
          Each step lights up green when its condition is met; Fill
          flashes green briefly then resets the whole tracker. Replaces
          the old top-of-page "Log your first slot" card. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        <StepChip done={step1Done} label="Pick a category" />
        <StepChip done={step2Done} label="Drag on the clock" />
        <StepChip done={step3Done} label="Fill" flash={step3Done} />
      </div>

      {/* The day as a clock. 96 slots is exactly 2 rings x 12 hours x 4
          quarters, so it lands on a dial with nothing left over. The hour
          numbers sit permanently on the rim, which is why a label can no
          longer push the time out of its own cell. */}
      <div className="mb-3">
        <DayClock
          slots={clockSlots}
          activeCategory={cat}
          zoomable
          nowSlot={nowSlot}
          onSelect={(a, b) => {
            // Drag SELECTS. The existing Fill/Clear buttons below commit.
            // The old handler filled on release, so an over-drag painted
            // six hours of Sleep and left you to Clear it.
            setFrom(a);
            setUntil(b);
          }}
        />
        {/* The old "Pick a category first ↑" hint sat here. Retired:
            the StepChip strip above the clock does that job now, and it
            lives in the same spot regardless of state so the eye
            doesn't have to hunt for a hint that appears and disappears. */}
      </div>

      {metrics && (
        <div className="card p-4">
          {/* Header is now a clickable toggle. A filled-count sits next
              to the chevron so you can see at a glance whether the day
              already has any metrics logged without opening it. */}
          <button
            onClick={() => {
              const next = !metricsOpen;
              setMetricsOpen(next);
              try { localStorage.setItem("daymax-metrics-open", next ? "1" : "0"); } catch {}
            }}
            className="mb-2 flex w-full items-center gap-2 text-left"
            aria-expanded={metricsOpen}
          >
            <h2 className="font-semibold">Day metrics</h2>
            {(() => {
              const filledMetrics = metricFields.filter((f) => metrics[f.key] != null).length + (metrics.notes ? 1 : 0);
              return filledMetrics > 0 ? (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
                  {filledMetrics} filled
                </span>
              ) : (
                <span className="text-xs text-faint">none logged</span>
              );
            })()}
            <span className="ml-auto text-sm text-faint">{metricsOpen ? "▲" : "▼"}</span>
          </button>
          {metricsOpen && (
          <>
          {/* Anything scored out of ten is a slider. Typing "7" into a spinner
              to answer "how tired were you" is the wrong instrument — you are
              picking a point on a scale, not entering a measurement. Free
              quantities (deep time, weight) stay as number fields. */}
          <div className="grid gap-3 sm:grid-cols-2">
            {metricFields.map((f) => {
              const scored = f.max != null;
              const v = metrics[f.key];
              if (!scored) {
                return (
                  <label key={f.key} className="text-xs text-muted">
                    {f.label}
                    <input
                      type="number"
                      step="0.5"
                      inputMode="decimal"
                      value={v ?? ""}
                      onChange={(e) => setMetrics({ ...metrics, [f.key]: e.target.value === "" ? null : Number(e.target.value) })}
                      className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm text-ink"
                    />
                  </label>
                );
              }
              return (
                <div key={f.key} className="text-xs text-muted">
                  <div className="flex items-baseline justify-between">
                    <span>{f.label}</span>
                    <span className="tabular-nums font-semibold text-ink">
                      {v ?? "—"}
                      {v != null && <span className="font-normal text-faint">/{f.max}</span>}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={f.max}
                    step={0.5}
                    // an unset metric must not silently become 0 — it parks at
                    // the midpoint until you actually touch it
                    value={v ?? f.max! / 2}
                    onChange={(e) => setMetrics({ ...metrics, [f.key]: Number(e.target.value) })}
                    className={`mt-1 w-full accent-accent ${v == null ? "opacity-45" : ""}`}
                  />
                  {v != null && (
                    <button
                      onClick={() => setMetrics({ ...metrics, [f.key]: null })}
                      className="text-[10px] text-faint hover:text-danger"
                    >
                      clear
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <label className="mt-2 block text-xs text-muted">
            Notes
            <textarea
              value={metrics.notes ?? ""}
              onChange={(e) => setMetrics({ ...metrics, notes: e.target.value || null })}
              rows={3}
              className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <span className="mt-2 inline-flex items-center gap-2">
            <button onClick={() => void saveMetrics()} disabled={saving} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast disabled:opacity-40">
              {saving ? "Saving…" : "Save metrics"}
            </button>
            {metricsSaved && <span className="text-sm font-medium text-ok">Saved ✓</span>}
          </span>
          </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One chip in the three-step tracker. `done` is the ONLY state that
 * matters visually -- when it flips true, the chip goes ok-green with
 * a checkmark; otherwise it's a quiet outline. `flash` briefly cranks
 * the emphasis for step 3 right after a Fill so the completion reads
 * as a moment, not a static state.
 */
function StepChip({ done, label, flash }: { done: boolean; label: string; flash?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition ${
        done
          ? `border-ok bg-ok-soft font-semibold text-ok ${flash ? "scale-105 shadow-md shadow-ok/30" : ""}`
          : "border-border text-muted"
      }`}
    >
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full" style={{ background: done ? "var(--ok)" : "transparent", border: done ? "none" : "1px solid var(--border)", color: done ? "var(--ok-soft)" : "transparent" }}>
        {done ? "✓" : ""}
      </span>
      {label}
    </span>
  );
}
