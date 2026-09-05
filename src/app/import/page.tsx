"use client";

/**
 * Import: upload the workbook (or paste a grid / DayMax JSON), see exactly
 * what will change, then confirm. Nothing is saved without the preview step.
 * Merge rule: last write wins per day, and only after you confirm.
 */

import { useState } from "react";
import { fetchDayEntries, insertLifts, upsertDailyMetrics, upsertDayEntries, upsertDayMetrics } from "@/lib/data";
import { parsePastedGrid, parseWorkbook, type WorkbookParseResult } from "@/lib/xlsxIO";
import type { DailyMetric, DayEntry, DayMetrics, LiftEntry } from "@/lib/types";

interface Pending {
  entries: DayEntry[];
  metrics: DayMetrics[];
  lifts: LiftEntry[];
  daily: DailyMetric[];
  warnings: string[];
  skipped: string[];
  /** dates that already have data in the app and will be overwritten */
  conflictDates: string[];
}

export default function ImportPage() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");

  async function buildPending(entries: DayEntry[], metrics: DayMetrics[], lifts: LiftEntry[], daily: DailyMetric[], warnings: string[], skipped: string[]) {
    // find conflicts: incoming dates that already have slots in the app
    const dates = [...new Set(entries.map((e) => e.date))].sort();
    let conflictDates: string[] = [];
    if (dates.length > 0) {
      const existing = await fetchDayEntries(dates[0], dates[dates.length - 1]);
      const existingDates = new Set(existing.map((e) => e.date));
      conflictDates = dates.filter((d) => existingDates.has(d));
    }
    setPending({ entries, metrics, lifts, daily, warnings, skipped, conflictDates });
    setDone(null);
  }

  async function onFile(f: File | null) {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const r: WorkbookParseResult = await parseWorkbook(f);
      const entries = r.grids.flatMap((g) => g.entries);
      const metrics = r.grids.flatMap((g) => g.metrics);
      const lifts = [...r.lifts.flatMap((l) => l.entries), ...r.daily.flatMap((d) => d.lifts)];
      const daily = r.daily.flatMap((d) => d.metrics);
      const warnings = [...r.grids, ...r.lifts, ...r.daily].flatMap((x) => x.warnings);
      await buildPending(entries, metrics, lifts, daily, warnings, r.skipped);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function onPaste() {
    setBusy(true);
    setError(null);
    try {
      const r = parsePastedGrid(paste);
      await buildPending(r.entries, r.metrics, [], [], r.warnings, []);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function onJson(f: File | null) {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const data = JSON.parse(await f.text());
      const items = Array.isArray(data) ? data : [data];
      const entries: DayEntry[] = [];
      const lifts: LiftEntry[] = [];
      const daily: DailyMetric[] = [];
      const dayMetrics: DayMetrics[] = [];
      const warnings: string[] = [];
      for (const it of items) {
        if (it.trackKind === "time_grid") {
          const slot = typeof it.slot === "string" ? (it.slot.split(":").map(Number)[0] * 4 + it.slot.split(":").map(Number)[1] / 15) : it.slot;
          const catNames: Record<string, number> = { sleep: 0, work: 1, sports: 2, social: 3, travel: 4, misc: 5, other: 6, eat: 7, family: 8, leisure: 9 };
          const category = typeof it.category === "number" ? it.category : catNames[String(it.category).toLowerCase()];
          if (category == null || !Number.isInteger(slot) || slot < 0 || slot > 95) {
            warnings.push(`Rejected time_grid item: ${JSON.stringify(it).slice(0, 80)}`);
            continue;
          }
          entries.push({ date: it.date, slot, category, label: it.label ?? it.subcategory ?? null });
        } else if (it.trackKind === "lifting") {
          for (const ex of it.exercises ?? []) {
            lifts.push({ date: it.date, exercise: ex.name, weightKg: ex.weightKg ?? null, reps: ex.reps != null ? String(ex.reps) : null, sets: ex.sets ?? null, notes: it.notes ?? null });
          }
        } else if (it.trackKind === "measurements") {
          daily.push({ date: it.date, metric: it.metric, value: it.value ?? null, textValue: it.textValue ?? null });
        } else if (it.trackKind === "day_metrics") {
          dayMetrics.push({
            date: it.date,
            emotionalScore: it.emotionalScore ?? null,
            tired: it.tired ?? null,
            startFriction: it.startFriction ?? null,
            endBrainFatigue: it.endBrainFatigue ?? null,
            deepTime: it.deepTime ?? null,
            weightKg: it.weightKg ?? null,
            notes: it.notes ?? null,
          });
        } else {
          warnings.push(`Unknown trackKind: ${JSON.stringify(it.trackKind)}`);
        }
      }
      await buildPending(entries, dayMetrics, lifts, daily, warnings, []);
    } catch (e: any) {
      setError(`Invalid JSON: ${String(e.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await upsertDayEntries(pending.entries);
      await upsertDayMetrics(pending.metrics);
      await insertLifts(pending.lifts);
      await upsertDailyMetrics(pending.daily);
      setDone(
        `Imported ${pending.entries.length} day slots, ${pending.metrics.length} day metrics, ${pending.lifts.length} lifts, ${pending.daily.length} daily numbers.`
      );
      setPending(null);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const dates = pending ? [...new Set(pending.entries.map((e) => e.date))].sort() : [];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-xl font-bold">Import</h1>
      <p className="mb-4 text-sm text-slate-500">
        Upload your workbook, paste a month grid straight from Excel, or upload DayMax JSON produced by
        ChatGPT/Claude (see docs/DATA_CONTRACT.md). You always get a preview before anything is saved.
      </p>
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {done && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{done}</p>}

      {!pending && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-white p-4">
            <h2 className="font-semibold">Excel workbook (.xlsx)</h2>
            <p className="mb-2 text-sm text-slate-500">Month grids, lift log and daily numbers are detected automatically. The tape sheet is skipped (not in v1).</p>
            <input type="file" accept=".xlsx,.xls" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </div>
          <div className="rounded-xl border bg-white p-4">
            <h2 className="font-semibold">Paste a grid</h2>
            <p className="mb-2 text-sm text-slate-500">Copy the month grid in Excel (including the date row and time column) and paste here.</p>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} placeholder={"\t\t\t2026-09-01\t2026-09-02\n\t\t0:00\t0 Sleep\t0 Sleep"} className="mb-2 w-full rounded-md border px-2 py-1.5 font-mono text-xs" />
            <button onClick={() => void onPaste()} disabled={busy || paste.trim() === ""} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Preview paste
            </button>
          </div>
          <div className="rounded-xl border bg-white p-4">
            <h2 className="font-semibold">DayMax JSON</h2>
            <p className="mb-2 text-sm text-slate-500">The format other AIs produce. Invalid items are rejected and listed, never guessed.</p>
            <input type="file" accept=".json" onChange={(e) => void onJson(e.target.files?.[0] ?? null)} className="text-sm" />
          </div>
        </div>
      )}

      {pending && (
        <div className="rounded-xl border bg-white p-4">
          <h2 className="mb-2 text-lg font-semibold">Preview — nothing saved yet</h2>
          <ul className="mb-3 space-y-1 text-sm">
            <li>📅 <b>{pending.entries.length}</b> day slots across <b>{dates.length}</b> days {dates.length > 0 && <span className="text-slate-500">({dates[0]} → {dates[dates.length - 1]})</span>}</li>
            <li>📝 <b>{pending.metrics.length}</b> day metric rows (emotional score, notes, …)</li>
            <li>🏋️ <b>{pending.lifts.length}</b> lift entries</li>
            <li>📈 <b>{pending.daily.length}</b> daily numbers (bodyweight, run time, …)</li>
            {pending.skipped.length > 0 && <li className="text-slate-500">Skipped sheets: {pending.skipped.join(", ")}</li>}
          </ul>

          {pending.conflictDates.length > 0 && (
            <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <b>{pending.conflictDates.length} days already have data in the app</b> and will be overwritten
              (last write wins): {pending.conflictDates.slice(0, 10).join(", ")}
              {pending.conflictDates.length > 10 && ` … +${pending.conflictDates.length - 10} more`}
            </div>
          )}

          {pending.warnings.length > 0 && (
            <div className="mb-3 max-h-48 overflow-auto rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              <b>{pending.warnings.length} cells could not be parsed and will be skipped</b> — fix them in the
              source and re-import, or add them manually:
              <ul className="mt-1 list-inside list-disc">
                {pending.warnings.slice(0, 50).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {pending.warnings.length > 50 && <li>… +{pending.warnings.length - 50} more</li>}
              </ul>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => void confirm()} disabled={busy} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              {busy ? "Importing…" : "Confirm import"}
            </button>
            <button onClick={() => setPending(null)} disabled={busy} className="rounded-md border px-4 py-2 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
