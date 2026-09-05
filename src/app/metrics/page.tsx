"use client";

/**
 * Metrics: browse and edit every day's metrics — emotional score, tired,
 * start friction, brain fatigue, deep time, weight and notes — in one table.
 */

import { useEffect, useMemo, useState } from "react";
import { fetchDayMetrics, upsertDayMetrics } from "@/lib/data";
import type { DayMetrics } from "@/lib/types";
import { localToday } from "@/lib/dates";

const NUM_FIELDS: Array<{ key: keyof Omit<DayMetrics, "date" | "notes">; label: string }> = [
  { key: "emotionalScore", label: "Emotion /10" },
  { key: "tired", label: "Tired /10" },
  { key: "startFriction", label: "Start friction" },
  { key: "endBrainFatigue", label: "Brain fatigue" },
  { key: "deepTime", label: "Deep time (h)" },
  { key: "weightKg", label: "Weight (kg)" },
];

function emptyRow(date: string): DayMetrics {
  return { date, emotionalScore: null, tired: null, startFriction: null, endBrainFatigue: null, deepTime: null, weightKg: null, notes: null };
}

export default function MetricsPage() {
  const todayISO = localToday();
  const [rows, setRows] = useState<DayMetrics[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [newDate, setNewDate] = useState(todayISO);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetchDayMetrics("2000-01-01", "2100-01-01")
      .then((ms) => setRows(ms.sort((a, b) => (a.date > b.date ? -1 : 1))))
      .catch((e) => setMsg(String(e.message ?? e)));
  }, []);

  function edit(date: string, patch: Partial<DayMetrics>) {
    setRows((rs) => rs.map((r) => (r.date === date ? { ...r, ...patch } : r)));
    setDirty((d) => new Set(d).add(date));
  }

  async function saveAll() {
    setSaving(true);
    setMsg(null);
    try {
      await upsertDayMetrics(rows.filter((r) => dirty.has(r.date)));
      setDirty(new Set());
      setMsg("Saved ✓");
      setTimeout(() => setMsg(null), 2500);
    } catch (e: any) {
      setMsg(String(e.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  const visible = useMemo(
    () => (filter ? rows.filter((r) => r.date.includes(filter) || (r.notes ?? "").toLowerCase().includes(filter.toLowerCase())) : rows),
    [rows, filter]
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">Metrics</h1>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by date or notes…" className="w-56 rounded-lg border bg-surface px-3 py-1.5 text-sm" />
        <span className="ml-auto inline-flex items-center gap-2">
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="rounded-lg border bg-surface px-2 py-1.5 text-sm" />
          <button
            onClick={() => {
              if (!rows.some((r) => r.date === newDate)) {
                setRows((rs) => [emptyRow(newDate), ...rs].sort((a, b) => (a.date > b.date ? -1 : 1)));
                setDirty((d) => new Set(d).add(newDate));
              }
            }}
            className="btn-ghost py-1.5"
          >
            Add day
          </button>
          <button onClick={() => void saveAll()} disabled={saving || dirty.size === 0} className="btn-primary py-1.5">
            {saving ? "Saving…" : `Save${dirty.size ? ` (${dirty.size})` : ""}`}
          </button>
        </span>
      </div>
      {msg && <p className="mb-2 text-sm text-ok">{msg}</p>}

      <div className="max-h-[75vh] overflow-auto card">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2">Date</th>
              {NUM_FIELDS.map((f) => (
                <th key={f.key} className="px-2 py-2">{f.label}</th>
              ))}
              <th className="px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.date} className={`border-b align-top last:border-0 ${dirty.has(r.date) ? "bg-accent-soft/50" : ""}`}>
                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-muted">{r.date}</td>
                {NUM_FIELDS.map((f) => (
                  <td key={f.key} className="px-1 py-1">
                    <input
                      type="number"
                      step="0.5"
                      value={r[f.key] ?? ""}
                      onChange={(e) => edit(r.date, { [f.key]: e.target.value === "" ? null : Number(e.target.value) } as Partial<DayMetrics>)}
                      className="w-16 rounded-md border bg-surface px-1.5 py-1 text-sm"
                    />
                  </td>
                ))}
                <td className="px-2 py-1">
                  <textarea
                    value={r.notes ?? ""}
                    onChange={(e) => edit(r.date, { notes: e.target.value || null })}
                    rows={1}
                    className="w-full min-w-[16rem] rounded-md border bg-surface px-2 py-1 text-sm"
                  />
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-faint">
                  No day metrics yet — log them on the Today page or import your workbook.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-faint">Edit any cell, then Save. Edited rows are highlighted until saved.</p>
    </div>
  );
}
