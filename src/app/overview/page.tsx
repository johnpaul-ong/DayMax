"use client";

/**
 * Overview: the productivity ranking (day / week / all-time), stacked hours
 * per day, lift progression, and raw day data. Ranking uses parent-category
 * totals only — labels never leave your own views.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { categoryName, slotToTime } from "@/lib/categories";
import { fetchAllDayEntries, fetchBucketSettings, fetchLifts } from "@/lib/data";
import { bucketize, computeRanking, hoursByCategory, weekStart } from "@/lib/ranking";
import type { BucketSettings, DayEntry, LiftEntry } from "@/lib/types";

const BUCKET_COLORS = { productive: "#16a34a", brainrot: "#dc2626", other: "#94a3b8" };

export default function OverviewPage() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [entries, setEntries] = useState<DayEntry[]>([]);
  const [lifts, setLifts] = useState<Array<LiftEntry & { id: number }>>([]);
  const [settings, setSettings] = useState<BucketSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [rawDate, setRawDate] = useState(todayISO);

  useEffect(() => {
    Promise.all([fetchAllDayEntries(), fetchLifts(), fetchBucketSettings()])
      .then(([e, l, s]) => {
        setEntries(e);
        setLifts(l);
        setSettings(s);
      })
      .finally(() => setLoading(false));
  }, []);

  const ranking = useMemo(
    () => (settings ? computeRanking(entries, settings, todayISO) : []),
    [entries, settings, todayISO]
  );

  const dailyBuckets = useMemo(() => {
    if (!settings) return [];
    const byDate = new Map<string, DayEntry[]>();
    for (const e of entries) {
      byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(-42)
      .map(([date, list]) => {
        const t = bucketize(hoursByCategory(list), settings);
        return { date: date.slice(5), ...t };
      });
  }, [entries, settings]);

  const liftSeries = useMemo(() => {
    const byExercise = new Map<string, Array<{ date: string; weight: number }>>();
    for (const l of [...lifts].reverse()) {
      if (l.weightKg == null) continue;
      byExercise.set(l.exercise, [...(byExercise.get(l.exercise) ?? []), { date: l.date, weight: l.weightKg }]);
    }
    return [...byExercise.entries()]
      .filter(([, pts]) => pts.length >= 3)
      .sort(([, a], [, b]) => b.length - a.length)
      .slice(0, 4);
  }, [lifts]);

  const rawDay = useMemo(
    () => entries.filter((e) => e.date === rawDate).sort((a, b) => a.slot - b.slot),
    [entries, rawDate]
  );

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-3 text-xl font-bold">Productivity ranking</h1>
        <div className="grid gap-3 sm:grid-cols-3">
          {ranking.map((r) => (
            <div key={r.period} className="rounded-xl border bg-white p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {r.period === "day" ? "Today" : r.period === "week" ? `This week (from ${weekStart(todayISO).slice(5)})` : "All time"}
              </h2>
              <div className="mt-2 space-y-1 text-sm">
                <p><span className="font-bold text-green-600">{r.totals.productive.toFixed(1)}h</span> productive</p>
                <p><span className="font-bold text-red-600">{r.totals.brainrot.toFixed(1)}h</span> brainrot</p>
                <p><span className="font-bold text-slate-500">{r.totals.other.toFixed(1)}h</span> other</p>
                <p className="pt-1 text-xs text-slate-500">
                  ratio {r.ratio === null ? "∞" : r.ratio} productive:brainrot
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-400">Both stats shown so neither can be gamed. Change bucket assignments in Settings.</p>
      </section>

      {dailyBuckets.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Hours per day (last {dailyBuckets.length} logged days)</h2>
          <div className="h-64 rounded-xl border bg-white p-2">
            <ResponsiveContainer>
              <BarChart data={dailyBuckets}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 24]} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="productive" stackId="a" fill={BUCKET_COLORS.productive} />
                <Bar dataKey="brainrot" stackId="a" fill={BUCKET_COLORS.brainrot} />
                <Bar dataKey="other" stackId="a" fill={BUCKET_COLORS.other} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {liftSeries.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Lift progression</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {liftSeries.map(([name, pts]) => (
              <div key={name} className="h-48 rounded-xl border bg-white p-2">
                <p className="px-2 pt-1 text-sm font-medium">{name}</p>
                <ResponsiveContainer height="85%">
                  <LineChart data={pts}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="weight" stroke="#2563eb" dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Raw day</h2>
        <input type="date" value={rawDate} onChange={(e) => setRawDate(e.target.value)} className="mb-2 rounded-md border px-2 py-1 text-sm" />
        {rawDay.length === 0 ? (
          <p className="text-sm text-slate-400">No entries for {rawDate}.</p>
        ) : (
          <div className="max-h-80 overflow-auto rounded-xl border bg-white">
            <table className="w-full text-sm">
              <tbody>
                {rawDay.map((e) => (
                  <tr key={e.slot} className="border-b last:border-0">
                    <td className="w-16 px-3 py-1 font-mono text-xs text-slate-400">{slotToTime(e.slot)}</td>
                    <td className="px-3 py-1">{categoryName(e.category)}</td>
                    <td className="px-3 py-1 text-slate-500">{e.label ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
