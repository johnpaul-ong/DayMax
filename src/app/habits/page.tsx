"use client";

/**
 * Habits: track any daily number — words written, Duolingo XP, pages read,
 * km run. Pick from the shared registry or invent your own. Personal for now;
 * habit communities and Arena competition come next once this is proven.
 */

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchDailyMetrics, upsertDailyMetrics } from "@/lib/data";
import { createClient } from "@/lib/supabase/client";
import { localToday } from "@/lib/dates";

interface MetricType {
  key: string;
  name: string;
  unit: string;
  direction: "more" | "less";
}

const tickDate = (d: string) => (typeof d === "string" ? d.slice(5) : d);
/** "Words a day" -> "words_a_day" */
const toKey = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export default function HabitsPage() {
  const todayISO = localToday();
  const [types, setTypes] = useState<MetricType[]>([]);
  const [mine, setMine] = useState<string[]>([]); // metric keys I have data for
  const [series, setSeries] = useState<Record<string, Array<{ date: string; value: number }>>>({});
  const [error, setError] = useState<string | null>(null);

  // log form
  const [logKey, setLogKey] = useState("");
  const [logDate, setLogDate] = useState(todayISO);
  const [logValue, setLogValue] = useState("");
  const [saved, setSaved] = useState(false);

  // create form
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [newDirection, setNewDirection] = useState<"more" | "less">("more");

  const RESERVED = ["bodyweight_kg", "run_time_min", "tuna_rice"];

  async function reload() {
    const supabase = createClient();
    try {
      const { data: t, error: e1 } = await supabase.from("metric_types").select("key, name, unit, direction").order("name");
      if (e1) throw e1;
      setTypes((t ?? []) as MetricType[]);
      const { data: m, error: e2 } = await supabase.from("daily_metrics").select("metric").limit(1000);
      if (e2) throw e2;
      const keys = [...new Set((m ?? []).map((r: any) => String(r.metric)))].filter((k) => !RESERVED.includes(k));
      setMine(keys);
      const loaded: Record<string, Array<{ date: string; value: number }>> = {};
      await Promise.all(
        keys.map(async (k) => {
          const rows = await fetchDailyMetrics(k);
          loaded[k] = rows.filter((r) => r.value != null).map((r) => ({ date: r.date, value: r.value! }));
        })
      );
      setSeries(loaded);
      if (!logKey && keys.length) setLogKey(keys[0]);
    } catch (e: any) {
      setError(
        String(e.message ?? e).includes("does not exist") || String(e.message ?? e).includes("schema cache")
          ? "Habits needs migration 0012 — run supabase/migrations/0012_friends_search_habits.sql in the Supabase SQL Editor."
          : String(e.message ?? e)
      );
    }
  }
  useEffect(() => {
    void reload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const typeFor = (key: string): MetricType =>
    types.find((t) => t.key === key) ?? { key, name: key.replace(/_/g, " "), unit: "", direction: "more" };

  async function log() {
    const v = Number(logValue);
    if (!logKey || !Number.isFinite(v)) return;
    try {
      await upsertDailyMetrics([{ date: logDate, metric: logKey, value: v, textValue: null }]);
      setLogValue("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      void reload();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  }

  async function createType() {
    const name = newName.trim();
    if (!name) return;
    const key = toKey(name);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: e } = await supabase
      .from("metric_types")
      .insert({ key, name, unit: newUnit.trim(), direction: newDirection, created_by: user?.id });
    if (e && !String(e.message).includes("duplicate")) {
      setError(String(e.message));
      return;
    }
    setNewName("");
    setNewUnit("");
    setLogKey(key);
    void reload();
  }

  const stats = (pts: Array<{ date: string; value: number }>) => {
    const total = pts.reduce((s, p) => s + p.value, 0);
    const best = Math.max(...pts.map((p) => p.value));
    const today = pts.find((p) => p.date === todayISO)?.value ?? null;
    // current streak: consecutive days ending today/yesterday with entries
    const dates = new Set(pts.map((p) => p.date));
    let streak = 0;
    const d = new Date();
    if (!dates.has(todayISO)) d.setDate(d.getDate() - 1);
    for (;;) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!dates.has(iso)) break;
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return { total, best, today, streak };
  };

  const loggable = useMemo(() => {
    const keys = new Set<string>(mine);
    for (const t of types) keys.add(t.key);
    return [...keys].filter((k) => !RESERVED.includes(k)).sort();
  }, [mine, types]);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-bold">Habits</h1>
        <p className="text-sm text-muted">Any daily number — words written, XP earned, pages read. One value per day, charts forever.</p>
      </div>
      {error && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>}

      <div className="card p-4">
        <h2 className="mb-2 font-semibold">Log a value</h2>
        <div className="flex flex-wrap items-end gap-2">
          <select value={logKey} onChange={(e) => setLogKey(e.target.value)} className="rounded-lg border bg-surface px-2 py-2 text-sm">
            <option value="">— pick a habit —</option>
            {loggable.map((k) => (
              <option key={k} value={k}>{typeFor(k).name}</option>
            ))}
          </select>
          <input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} className="rounded-lg border bg-surface px-2 py-2 text-sm" />
          <input
            type="number"
            step="any"
            inputMode="decimal"
            value={logValue}
            onChange={(e) => setLogValue(e.target.value)}
            placeholder={logKey ? `Value${typeFor(logKey).unit ? ` (${typeFor(logKey).unit})` : ""}` : "Value"}
            className="w-32 rounded-lg border bg-surface px-2 py-2 text-sm"
          />
          <button onClick={() => void log()} disabled={!logKey || logValue.trim() === ""} className="btn-primary">Log</button>
          {saved && <span className="text-sm font-medium text-ok">Saved ✓</span>}
        </div>

        <div className="mt-4 border-t pt-3">
          <h3 className="mb-1 text-sm font-semibold">New habit</h3>
          <div className="flex flex-wrap items-end gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder='e.g. "Words a day"' className="w-44 rounded-lg border bg-surface px-2 py-2 text-sm" />
            <input value={newUnit} onChange={(e) => setNewUnit(e.target.value)} placeholder="Unit (words, XP, pages…)" className="w-44 rounded-lg border bg-surface px-2 py-2 text-sm" />
            <select value={newDirection} onChange={(e) => setNewDirection(e.target.value as "more" | "less")} className="rounded-lg border bg-surface px-2 py-2 text-sm">
              <option value="more">more is better</option>
              <option value="less">less is better</option>
            </select>
            <button onClick={() => void createType()} disabled={!newName.trim()} className="btn-ghost">Create</button>
          </div>
          <p className="mt-1 text-xs text-faint">Habit types are shared across DayMax so future competitions compare like with like.</p>
        </div>
      </div>

      {mine.length === 0 ? (
        <p className="card p-4 text-sm text-faint">No habits logged yet. Create one above and log today&apos;s number.</p>
      ) : (
        mine.map((k) => {
          const t = typeFor(k);
          const pts = series[k] ?? [];
          if (pts.length === 0) return null;
          const s = stats(pts);
          return (
            <section key={k}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="font-semibold">{t.name}</h2>
                <span className="text-sm text-muted">
                  today: <b>{s.today ?? "—"}</b> · streak: <b>{s.streak}d</b> · best: <b>{s.best}</b> · total: <b>{Math.round(s.total).toLocaleString()}</b> {t.unit}
                </span>
              </div>
              <div className="h-48 card p-2">
                <ResponsiveContainer>
                  <LineChart data={pts}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
                    <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                    <Tooltip labelFormatter={(d) => String(d)} />
                    <Line type="monotone" strokeWidth={2.5} dataKey="value" stroke="var(--accent)" dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
