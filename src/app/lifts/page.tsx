"use client";

/**
 * Lift logger: built for a phone at the rack. "Same as last time" repeats
 * your most recent entry for the chosen exercise with one tap.
 */

import { useEffect, useMemo, useState } from "react";
import {
  deleteLift,
  deleteLiftGoal,
  fetchLiftGoals,
  fetchLifts,
  insertLifts,
  setLiftGoalArchived,
  upsertLiftGoal,
  type LiftGoal,
} from "@/lib/data";
import type { LiftEntry } from "@/lib/types";

function GoalsCard({ rows }: { rows: LiftEntry[] }) {
  const [goals, setGoals] = useState<LiftGoal[]>([]);
  const [exercise, setExercise] = useState("");
  const [target, setTarget] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reload() {
    fetchLiftGoals()
      .then(setGoals)
      .catch(() => setErr("Goals need migration 0002 — run supabase/migrations/0002_goals_profile.sql in the Supabase SQL Editor."));
  }
  useEffect(reload, []);

  const bestFor = (name: string) =>
    Math.max(0, ...rows.filter((r) => r.exercise.toLowerCase() === name.toLowerCase() && r.weightKg != null).map((r) => r.weightKg!));

  const visible = goals.filter((g) => (showArchived ? true : !g.archived));

  return (
    <div className="mb-6 card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Goals</h2>
        {goals.some((g) => g.archived) && (
          <button onClick={() => setShowArchived((v) => !v)} className="text-xs text-accent hover:underline">
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
        )}
      </div>
      {err && <p className="mb-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">{err}</p>}

      {visible.map((g) => {
        const best = bestFor(g.exercise);
        const pct = Math.min(100, (best / g.targetWeightKg) * 100);
        const hit = best >= g.targetWeightKg;
        return (
          <div key={g.id} className={`mb-2 ${g.archived ? "opacity-50" : ""}`}>
            <div className="mb-0.5 flex items-baseline justify-between text-sm">
              <span className="font-medium">
                {g.exercise} {hit && "🏆"}
              </span>
              <span className="text-xs text-muted">
                {best}kg / {g.targetWeightKg}kg ({pct.toFixed(0)}%{hit ? " — hit!" : `, ${(g.targetWeightKg - best).toFixed(1)}kg to go`})
                <button onClick={() => void setLiftGoalArchived(g.id, !g.archived).then(reload)} className="ml-2 text-accent hover:underline">
                  {g.archived ? "restore" : "archive"}
                </button>
                <button onClick={() => void deleteLiftGoal(g.id).then(reload)} className="ml-2 text-danger hover:opacity-70">
                  remove
                </button>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      {visible.length === 0 && !err && <p className="mb-2 text-sm text-faint">No goals yet. Give yourself a target.</p>}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <input value={exercise} onChange={(e) => setExercise(e.target.value)} placeholder="Exercise" className="w-36 rounded-lg border bg-surface px-2 py-2 text-sm" />
        <input value={target} onChange={(e) => setTarget(e.target.value)} type="number" step="0.5" inputMode="decimal" placeholder="Target kg" className="w-28 rounded-lg border bg-surface px-2 py-2 text-sm" />
        <button
          onClick={() => {
            const t = Number(target);
            if (!exercise.trim() || !Number.isFinite(t) || t <= 0) return;
            void upsertLiftGoal(exercise.trim(), t).then(() => {
              setExercise("");
              setTarget("");
              reload();
            });
          }}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast"
        >
          Set goal
        </button>
      </div>
    </div>
  );
}

export default function LiftsPage() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [rows, setRows] = useState<Array<LiftEntry & { id: number }>>([]);
  const [form, setForm] = useState<LiftEntry>({
    date: todayISO,
    exercise: "",
    weightKg: null,
    reps: null,
    sets: null,
    notes: null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    fetchLifts()
      .then(setRows)
      .catch((e) => setError(String(e.message ?? e)));
  }
  useEffect(reload, []);

  const knownExercises = useMemo(() => [...new Set(rows.map((r) => r.exercise))].sort(), [rows]);
  const lastForExercise = useMemo(
    () => rows.find((r) => r.exercise.toLowerCase() === form.exercise.trim().toLowerCase()),
    [rows, form.exercise]
  );

  async function save(entry: LiftEntry) {
    if (!entry.exercise.trim()) {
      setError("Exercise name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await insertLifts([{ ...entry, exercise: entry.exercise.trim() }]);
      setForm({ ...form, weightKg: null, reps: null, sets: null, notes: null });
      reload();
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-3 text-xl font-bold">Lifts</h1>
      {error && <p className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="mb-6 card p-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="col-span-2 text-xs text-muted sm:col-span-1">
            Date
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-0.5 w-full rounded-lg border px-2 py-2 text-sm text-ink" />
          </label>
          <label className="col-span-2 text-xs text-muted sm:col-span-1">
            Exercise
            <input
              list="exercises"
              value={form.exercise}
              onChange={(e) => setForm({ ...form, exercise: e.target.value })}
              placeholder="Deadlift"
              className="mt-0.5 w-full rounded-lg border px-2 py-2 text-sm text-ink"
            />
            <datalist id="exercises">
              {knownExercises.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </label>
          <label className="text-xs text-muted">
            Weight (kg)
            <input type="number" step="0.5" inputMode="decimal" value={form.weightKg ?? ""} onChange={(e) => setForm({ ...form, weightKg: e.target.value === "" ? null : Number(e.target.value) })} className="mt-0.5 w-full rounded-lg border px-2 py-2 text-sm text-ink" />
          </label>
          <label className="text-xs text-muted">
            Reps
            <input value={form.reps ?? ""} onChange={(e) => setForm({ ...form, reps: e.target.value || null })} placeholder="5 or AMRAP" className="mt-0.5 w-full rounded-lg border px-2 py-2 text-sm text-ink" />
          </label>
          <label className="text-xs text-muted">
            Sets
            <input type="number" inputMode="numeric" value={form.sets ?? ""} onChange={(e) => setForm({ ...form, sets: e.target.value === "" ? null : Number(e.target.value) })} className="mt-0.5 w-full rounded-lg border px-2 py-2 text-sm text-ink" />
          </label>
          <label className="col-span-2 text-xs text-muted sm:col-span-3">
            Notes
            <input value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value || null })} placeholder="RPE 8" className="mt-0.5 w-full rounded-lg border px-2 py-2 text-sm text-ink" />
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={() => void save(form)} disabled={saving} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast disabled:opacity-40">
            Log lift
          </button>
          {lastForExercise && (
            <button
              onClick={() => void save({ ...lastForExercise, date: form.date })}
              disabled={saving}
              className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40"
            >
              Same as last time ({lastForExercise.weightKg ?? "?"}kg × {lastForExercise.reps ?? "?"})
            </button>
          )}
        </div>
      </div>

      <GoalsCard rows={rows} />

      <h2 className="mb-2 font-semibold">History</h2>
      <div className="overflow-x-auto card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-surface-2 text-left text-xs text-muted">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Exercise</th>
              <th className="px-3 py-2">Weight</th>
              <th className="px-3 py-2">Reps</th>
              <th className="px-3 py-2">Sets</th>
              <th className="px-3 py-2">Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="whitespace-nowrap px-3 py-1.5">{r.date}</td>
                <td className="px-3 py-1.5 font-medium">{r.exercise}</td>
                <td className="px-3 py-1.5">{r.weightKg ?? ""}</td>
                <td className="px-3 py-1.5">{r.reps ?? ""}</td>
                <td className="px-3 py-1.5">{r.sets ?? ""}</td>
                <td className="max-w-[24ch] truncate px-3 py-1.5 text-muted" title={r.notes ?? ""}>
                  {r.notes ?? ""}
                </td>
                <td className="px-2 py-1.5">
                  <button
                    onClick={() => {
                      void deleteLift(r.id).then(reload);
                    }}
                    className="text-xs text-danger hover:opacity-70"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-faint">
                  No lifts yet. Log one above or import your workbook.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
