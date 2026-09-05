"use client";

/**
 * Overview: ranking, bucket hours by day/week/month, correlation explorer
 * ("does tired kill my productivity?"), lift progression vs goals, and
 * bodyweight trend. Ranking uses parent-category totals only.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { categoryName, slotToTime } from "@/lib/categories";
import {
  fetchAllDayEntries,
  fetchBucketSettings,
  fetchDailyMetrics,
  fetchDayMetrics,
  fetchLiftGoals,
  fetchLifts,
  type LiftGoal,
} from "@/lib/data";
import { computeRanking, weekStart } from "@/lib/ranking";
import { bucketsByPeriod, buildDayPoints, CORRELATION_FIELDS, describeR, pearson, type Period } from "@/lib/stats";
import { DEFAULT_BUCKET_COLORS, loadBucketColors, type BucketColors } from "@/lib/theme";
import type { BucketSettings, DayEntry, DayMetrics, LiftEntry } from "@/lib/types";

export default function OverviewPage() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [entries, setEntries] = useState<DayEntry[]>([]);
  const [dayMetrics, setDayMetrics] = useState<DayMetrics[]>([]);
  const [lifts, setLifts] = useState<Array<LiftEntry & { id: number }>>([]);
  const [goals, setGoals] = useState<LiftGoal[]>([]);
  const [bodyweight, setBodyweight] = useState<Array<{ date: string; kg: number }>>([]);
  const [settings, setSettings] = useState<BucketSettings | null>(null);
  const [colors, setColors] = useState<BucketColors>(DEFAULT_BUCKET_COLORS);
  const [loading, setLoading] = useState(true);
  const [rawDate, setRawDate] = useState(todayISO);
  const [period, setPeriod] = useState<Period>("day");
  const [xField, setXField] = useState("tired");
  const [yField, setYField] = useState("productive");

  useEffect(() => {
    setColors(loadBucketColors());
    Promise.all([
      fetchAllDayEntries(),
      fetchLifts(),
      fetchBucketSettings(),
      fetchDayMetrics("2000-01-01", "2100-01-01"),
      fetchDailyMetrics("bodyweight_kg"),
      fetchLiftGoals().catch(() => [] as LiftGoal[]), // graceful before migration 0002
    ])
      .then(([e, l, s, dm, bw, g]) => {
        setEntries(e);
        setLifts(l);
        setSettings(s);
        setDayMetrics(dm);
        setGoals(g);
        // bodyweight from both sources: daily_metrics + day_metrics footer weight
        const map = new Map<string, number>();
        for (const m of bw) if (m.value != null) map.set(m.date, m.value);
        for (const m of dm) if (m.weightKg != null && !map.has(m.date)) map.set(m.date, m.weightKg);
        setBodyweight([...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, kg]) => ({ date, kg })));
      })
      .finally(() => setLoading(false));
  }, []);

  const ranking = useMemo(
    () => (settings ? computeRanking(entries, settings, todayISO) : []),
    [entries, settings, todayISO]
  );

  const periodBuckets = useMemo(() => {
    if (!settings) return [];
    const all = bucketsByPeriod(entries, settings, period);
    const keep = period === "day" ? 42 : period === "week" ? 30 : 24;
    return all.slice(-keep);
  }, [entries, settings, period]);

  // correlation
  const dayPoints = useMemo(
    () => (settings ? buildDayPoints(entries, dayMetrics, settings) : []),
    [entries, dayMetrics, settings]
  );
  const scatterData = useMemo(
    () =>
      dayPoints
        .filter((p) => p[xField] != null && p[yField] != null)
        .map((p) => ({ date: p.date, x: p[xField] as number, y: p[yField] as number })),
    [dayPoints, xField, yField]
  );
  const r = useMemo(() => pearson(scatterData.map((p) => [p.x, p.y] as [number, number])), [scatterData]);
  const fieldLabel = (k: string) => CORRELATION_FIELDS.find((f) => f.key === k)?.label ?? k;

  // lift progression with % change and goals
  const liftSeries = useMemo(() => {
    const byExercise = new Map<string, Array<{ date: string; weight: number }>>();
    for (const l of [...lifts].sort((a, b) => (a.date < b.date ? -1 : 1))) {
      if (l.weightKg == null) continue;
      byExercise.set(l.exercise, [...(byExercise.get(l.exercise) ?? []), { date: l.date, weight: l.weightKg }]);
    }
    return [...byExercise.entries()]
      .filter(([, pts]) => pts.length >= 2)
      .map(([name, pts]) => {
        const first = pts[0].weight;
        const best = Math.max(...pts.map((p) => p.weight));
        const latest = pts[pts.length - 1].weight;
        const goal = goals.find((g) => !g.archived && g.exercise.toLowerCase() === name.toLowerCase());
        return {
          name,
          pts,
          first,
          best,
          latest,
          pctTotal: first > 0 ? ((latest - first) / first) * 100 : 0,
          goal: goal?.targetWeightKg ?? null,
          pctToGoal: goal ? Math.min(100, (best / goal.targetWeightKg) * 100) : null,
        };
      })
      .sort((a, b) => b.pts.length - a.pts.length)
      .slice(0, 8);
  }, [lifts, goals]);

  const bwChange = bodyweight.length >= 2 ? bodyweight[bodyweight.length - 1].kg - bodyweight[0].kg : null;

  const rawDay = useMemo(
    () => entries.filter((e) => e.date === rawDate).sort((a, b) => a.slot - b.slot),
    [entries, rawDate]
  );

  if (loading) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-10">
      <section>
        <h1 className="mb-3 text-xl font-bold">Productivity ranking</h1>
        <div className="grid gap-3 sm:grid-cols-3">
          {ranking.map((rk) => (
            <div key={rk.period} className="card p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">
                {rk.period === "day" ? "Today" : rk.period === "week" ? `This week (from ${weekStart(todayISO).slice(5)})` : "All time"}
              </h2>
              <div className="mt-2 space-y-1 text-sm">
                <p><span className="font-bold" style={{ color: colors.productive }}>{rk.totals.productive.toFixed(1)}h</span> productive</p>
                <p><span className="font-bold" style={{ color: colors.brainrot }}>{rk.totals.brainrot.toFixed(1)}h</span> brainrot</p>
                <p><span className="font-bold text-muted">{rk.totals.other.toFixed(1)}h</span> other</p>
                <p className="pt-1 text-xs text-muted">ratio {rk.ratio === null ? "∞" : rk.ratio} productive:brainrot</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {periodBuckets.length > 0 && (
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h2 className="font-semibold">Hours per {period}</h2>
            <div className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
              {(["day", "week", "month"] as const).map((p) => (
                <button key={p} onClick={() => setPeriod(p)} className={`rounded-lg px-3 py-1 capitalize ${period === p ? "bg-surface font-semibold" : "text-muted"}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="h-64 card p-2">
            <ResponsiveContainer>
              <BarChart data={periodBuckets}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => `${Number(v).toFixed(1)}h`} />
                <Legend />
                <Bar dataKey="productive" stackId="a" fill={colors.productive} />
                <Bar dataKey="brainrot" stackId="a" fill={colors.brainrot} />
                <Bar dataKey="other" stackId="a" fill={colors.other} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-1 font-semibold">Correlations</h2>
        <p className="mb-2 text-sm text-muted">Each dot is one day. Pick two things and see if they move together.</p>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <select value={xField} onChange={(e) => setXField(e.target.value)} className="rounded-lg border bg-surface px-2 py-1.5">
            {CORRELATION_FIELDS.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          <span className="text-muted">vs</span>
          <select value={yField} onChange={(e) => setYField(e.target.value)} className="rounded-lg border bg-surface px-2 py-1.5">
            {CORRELATION_FIELDS.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          {r != null && (
            <span className="rounded-full border bg-surface px-3 py-1 text-xs font-medium">
              r = {r.toFixed(2)} — {describeR(r)}
            </span>
          )}
          <span className="text-xs text-faint">{scatterData.length} days with both values</span>
        </div>
        <div className="h-72 card p-2">
          {scatterData.length < 3 ? (
            <p className="p-4 text-sm text-faint">Not enough days with both values yet — log day metrics (emotional score, tired…) on the Today page.</p>
          ) : (
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" dataKey="x" name={fieldLabel(xField)} tick={{ fontSize: 10 }} domain={["auto", "auto"]} label={{ value: fieldLabel(xField), position: "insideBottom", offset: -5, fontSize: 11 }} />
                <YAxis type="number" dataKey="y" name={fieldLabel(yField)} tick={{ fontSize: 10 }} domain={["auto", "auto"]} label={{ value: fieldLabel(yField), angle: -90, position: "insideLeft", fontSize: 11 }} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v: number) => Number(v).toFixed(1)} labelFormatter={() => ""} />
                <Scatter data={scatterData} fill="var(--accent)" fillOpacity={0.7} />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {liftSeries.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Lift progression</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {liftSeries.map((s) => (
              <div key={s.name} className="card p-3">
                <div className="mb-1 flex items-baseline justify-between px-1">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted">
                    <span className={s.pctTotal >= 0 ? "font-semibold" : "font-semibold text-danger"} style={s.pctTotal >= 0 ? { color: colors.productive } : undefined}>
                      {s.pctTotal >= 0 ? "+" : ""}{s.pctTotal.toFixed(1)}%
                    </span>{" "}
                    total ({s.first} → {s.latest}kg)
                    {s.goal != null && <> · goal {s.goal}kg ({s.pctToGoal!.toFixed(0)}%)</>}
                  </p>
                </div>
                <div className="h-40">
                  <ResponsiveContainer>
                    <LineChart data={s.pts}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                      <YAxis domain={["auto", s.goal != null ? Math.max(s.goal * 1.05, s.best) : "auto"]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      {s.goal != null && <ReferenceLine y={s.goal} stroke={colors.productive} strokeDasharray="6 3" label={{ value: `goal ${s.goal}`, fontSize: 10, fill: colors.productive }} />}
                      <Line type="monotone" dataKey="weight" stroke="var(--accent)" dot={{ r: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-faint">Set, archive or remove goals on the Lifts page.</p>
        </section>
      )}

      {bodyweight.length >= 2 && (
        <section>
          <h2 className="mb-2 font-semibold">
            Bodyweight{" "}
            <span className="text-sm font-normal text-muted">
              {bwChange! >= 0 ? "+" : ""}{bwChange!.toFixed(1)}kg since {bodyweight[0].date}
            </span>
          </h2>
          <div className="h-56 card p-2">
            <ResponsiveContainer>
              <LineChart data={bodyweight}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} unit="kg" />
                <Tooltip />
                <Line type="monotone" dataKey="kg" stroke="var(--accent)" dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Raw day</h2>
        <input type="date" value={rawDate} onChange={(e) => setRawDate(e.target.value)} className="mb-2 rounded-lg border bg-surface px-2 py-1 text-sm" />
        {rawDay.length === 0 ? (
          <p className="text-sm text-faint">No entries for {rawDate}.</p>
        ) : (
          <div className="max-h-80 overflow-auto card">
            <table className="w-full text-sm">
              <tbody>
                {rawDay.map((e) => (
                  <tr key={e.slot} className="border-b last:border-0">
                    <td className="w-16 px-3 py-1 font-mono text-xs text-faint">{slotToTime(e.slot)}</td>
                    <td className="px-3 py-1">{categoryName(e.category)}</td>
                    <td className="px-3 py-1 text-muted">{e.label ?? ""}</td>
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
