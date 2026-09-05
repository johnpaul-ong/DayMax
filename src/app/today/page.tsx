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

export default function TodayPage() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(todayISO);
  const [cells, setCells] = useState<Map<number, { category: number; label: string | null }>>(new Map());
  const [cat, setCat] = useState<number>(0);
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState<number | null>(null);
  const [until, setUntil] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DayMetrics | null>(null);

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

  async function fill() {
    if (from == null || until == null) return;
    const [s0, s1] = from <= until ? [from, until] : [until, from];
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
      setFrom(null);
      setUntil(null);
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

  async function saveMetrics() {
    if (!metrics) return;
    setSaving(true);
    try {
      await upsertDayMetrics([{ ...metrics, date }]);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  const metricFields: Array<{ key: keyof Omit<DayMetrics, "date" | "notes">; label: string }> = [
    { key: "emotionalScore", label: "Emotional /10" },
    { key: "tired", label: "Tired /10" },
    { key: "startFriction", label: "Start friction" },
    { key: "endBrainFatigue", label: "Brain fatigue" },
    { key: "deepTime", label: "Deep time (h)" },
    { key: "weightKg", label: "Weight (kg)" },
  ];

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-xl font-bold">Today</h1>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border px-2 py-1 text-sm" />
        <span className="text-sm text-muted">{filled}/96 filled</span>
      </div>

      {error && <p className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="mb-3 grid grid-cols-2 gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c.code}
            onClick={() => setCat(c.code)}
            className={`rounded-lg border px-2 py-2.5 text-left text-sm font-medium ${cat === c.code ? "ring-2 ring-accent" : ""}`}
            style={{ background: c.color + "22", borderColor: c.color }}
          >
            {c.code} {c.name}
          </button>
        ))}
      </div>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Optional label (e.g. project, dinner, 5km run)"
        className="mb-3 w-full rounded-lg border px-3 py-2 text-sm"
      />

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="w-10 text-muted">{from != null ? slotToTime(from) : "from"}</span>
        <span>→</span>
        <span className="w-10 text-muted">{until != null ? slotToTime(until) : "until"}</span>
        <button onClick={() => void fill()} disabled={from == null || until == null || saving} className="ml-auto rounded-lg bg-accent px-4 py-2 font-semibold text-accent-contrast disabled:opacity-40">
          Fill
        </button>
        <button onClick={() => void clearRange()} disabled={from == null || until == null || saving} className="rounded-lg border px-3 py-2 disabled:opacity-40">
          Clear
        </button>
      </div>

      <div className="mb-6 grid grid-cols-8 gap-[3px]">
        {Array.from({ length: SLOTS_PER_DAY }, (_, s) => {
          const c = cells.get(s);
          const isEdge = s === from || s === until;
          const inRange = from != null && until != null && s >= Math.min(from, until) && s <= Math.max(from, until);
          return (
            <button
              key={s}
              onClick={() => {
                if (from == null || (from != null && until != null)) {
                  setFrom(s);
                  setUntil(null);
                } else setUntil(s);
              }}
              title={`${slotToTime(s)}${c ? ` — ${c.category} ${c.label ?? ""}` : ""}`}
              className={`h-8 rounded-md text-[9px] leading-none ${isEdge ? "ring-2 ring-accent" : inRange ? "ring-2 ring-accent/40" : ""}`}
              style={{
                background: c ? categoryColor(c.category) : "var(--surface-2)",
                color: c ? "rgba(255,255,255,.95)" : "var(--faint)",
              }}
            >
              {s % 4 === 0 ? slotToTime(s) : ""}
            </button>
          );
        })}
      </div>

      {metrics && (
        <div className="card p-4">
          <h2 className="mb-2 font-semibold">Day metrics</h2>
          <div className="grid grid-cols-2 gap-2">
            {metricFields.map((f) => (
              <label key={f.key} className="text-xs text-muted">
                {f.label}
                <input
                  type="number"
                  step="0.5"
                  value={metrics[f.key] ?? ""}
                  onChange={(e) => setMetrics({ ...metrics, [f.key]: e.target.value === "" ? null : Number(e.target.value) })}
                  className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm text-ink"
                />
              </label>
            ))}
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
          <button onClick={() => void saveMetrics()} disabled={saving} className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast disabled:opacity-40">
            Save metrics
          </button>
        </div>
      )}
    </div>
  );
}
