"use client";

/**
 * Overview: a customizable analytics page. Toggle sections on/off (saved on
 * this device). Sections: productivity ranking, hours per day/week/month,
 * build-your-own trends graph, correlation explorer, combined lifts graph.
 * Per-exercise progression and bodyweight live on the Lifts page.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchAllDayEntries,
  fetchBucketSettings,
  fetchDailyMetrics,
  fetchDayMetrics,
  fetchLiftGoals,
  fetchLifts,
  fetchProfile,
  type LiftGoal,
} from "@/lib/data";
import { computeRanking, weekStart } from "@/lib/ranking";
import { allPairCorrelations, bucketsByPeriod, buildDayPoints, CORRELATION_FIELDS, describeR, pearson, type DayPoint, type Period } from "@/lib/stats";
import { DEFAULT_BUCKET_COLORS, loadBucketColors, type BucketColors } from "@/lib/theme";
import type { BucketSettings, DayEntry, DayMetrics, LiftEntry } from "@/lib/types";
import { localToday } from "@/lib/dates";

// ---------- configurable sections ----------

const SECTIONS = [
  { key: "ranking", label: "Productivity ranking" },
  { key: "hours", label: "Hours per day/week/month" },
  { key: "daymetrics", label: "Day metrics" },
  { key: "trends", label: "Trends (pick your metrics)" },
  { key: "correlations", label: "Correlations" },
  { key: "lifts", label: "Lifts graph" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];
const DEFAULT_SECTIONS: Record<SectionKey, boolean> = {
  ranking: true,
  hours: true,
  daymetrics: true,
  trends: false,
  correlations: false,
  lifts: true,
};

const DAY_METRIC_LINES: Array<{ key: string; label: string }> = [
  { key: "emotionalScore", label: "Emotion" },
  { key: "tired", label: "Tired" },
  { key: "startFriction", label: "Start friction" },
  { key: "endBrainFatigue", label: "Brain fatigue" },
];

function loadSections(): Record<SectionKey, boolean> {
  try {
    const raw = localStorage.getItem("daymax-overview-sections");
    return raw ? { ...DEFAULT_SECTIONS, ...JSON.parse(raw) } : { ...DEFAULT_SECTIONS };
  } catch {
    return { ...DEFAULT_SECTIONS };
  }
}

// ---------- trends ----------

const TREND_FIELDS: Array<{ key: string; label: string }> = [
  { key: "score", label: "Focus score (/100)" },
  ...CORRELATION_FIELDS,
];
const TREND_COLORS = ["#4f6ef7", "#16a34a", "#dc2626", "#f59e0b", "#0ea5e9", "#a78bfa", "#ec4899", "#77705a", "#14b8a6"];

const tickDate = (d: string) => (typeof d === "string" ? d.slice(5) : d);

export default function OverviewPage() {
  const todayISO = localToday();
  const [entries, setEntries] = useState<DayEntry[]>([]);
  const [dayMetrics, setDayMetrics] = useState<DayMetrics[]>([]);
  const [lifts, setLifts] = useState<Array<LiftEntry & { id: number }>>([]);
  const [settings, setSettings] = useState<BucketSettings | null>(null);
  const [colors, setColors] = useState<BucketColors>(DEFAULT_BUCKET_COLORS);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("day");
  const [xField, setXField] = useState("tired");
  const [yField, setYField] = useState("productive");
  const [sections, setSections] = useState<Record<SectionKey, boolean>>(DEFAULT_SECTIONS);
  const [customizing, setCustomizing] = useState(false);
  const [trendKeys, setTrendKeys] = useState<string[]>(["score", "emotionalScore"]);
  const [trendRelative, setTrendRelative] = useState(true);
  const [goals, setGoals] = useState<LiftGoal[]>([]);
  const [targetWeight, setTargetWeight] = useState<number | null>(null);
  const [bodyweight, setBodyweight] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    setColors(loadBucketColors());
    setSections(loadSections());
    try {
      const tk = localStorage.getItem("daymax-trend-keys");
      if (tk) setTrendKeys(JSON.parse(tk));
    } catch {}
    Promise.all([fetchAllDayEntries(), fetchLifts(), fetchBucketSettings(), fetchDayMetrics("2000-01-01", "2100-01-01")])
      .then(([e, l, s, dm]) => {
        setEntries(e);
        setLifts(l);
        setSettings(s);
        setDayMetrics(dm);
        const map = new Map<string, number>();
        for (const m of dm) if (m.weightKg != null) map.set(m.date, m.weightKg);
        fetchDailyMetrics("bodyweight_kg")
          .then((bw) => {
            for (const m of bw) if (m.value != null) map.set(m.date, m.value);
            setBodyweight(new Map(map));
          })
          .catch(() => setBodyweight(new Map(map)));
      })
      .finally(() => setLoading(false));
    fetchLiftGoals().then(setGoals).catch(() => {});
    fetchProfile().then((p) => setTargetWeight(p.targetWeightKg)).catch(() => {});
  }, []);

  function toggleSection(key: SectionKey) {
    const next = { ...sections, [key]: !sections[key] };
    setSections(next);
    try {
      localStorage.setItem("daymax-overview-sections", JSON.stringify(next));
    } catch {}
  }

  function toggleTrendKey(key: string) {
    const next = trendKeys.includes(key) ? trendKeys.filter((k) => k !== key) : [...trendKeys, key];
    setTrendKeys(next);
    try {
      localStorage.setItem("daymax-trend-keys", JSON.stringify(next));
    } catch {}
  }

  const ranking = useMemo(() => (settings ? computeRanking(entries, settings, todayISO) : []), [entries, settings, todayISO]);

  const periodBuckets = useMemo(() => {
    if (!settings) return [];
    const all = bucketsByPeriod(entries, settings, period);
    const keep = period === "day" ? 42 : period === "week" ? 30 : 24;
    return all.slice(-keep);
  }, [entries, settings, period]);

  const dayPoints: DayPoint[] = useMemo(() => {
    if (!settings) return [];
    return buildDayPoints(entries, dayMetrics, settings).map((p) => {
      const prod = p.productive as number | null;
      const br = p.brainrot as number | null;
      const score = prod != null && br != null && prod + br > 0 ? Math.round((prod / (prod + br)) * 1000) / 10 : null;
      return { ...p, score };
    });
  }, [entries, dayMetrics, settings]);

  // trends: normalize each selected series to 0..100 (relative) or plot raw
  const trendData = useMemo(() => {
    const ranges = new Map<string, { min: number; max: number }>();
    for (const k of trendKeys) {
      const vals = dayPoints.map((p) => p[k] as number | null).filter((v): v is number => v != null);
      if (vals.length) ranges.set(k, { min: Math.min(...vals), max: Math.max(...vals) });
    }
    return dayPoints
      .filter((p) => trendKeys.some((k) => p[k] != null))
      .map((p) => {
        const row: Record<string, string | number | null> = { date: p.date };
        for (const k of trendKeys) {
          const v = p[k] as number | null;
          row[`${k}__raw`] = v;
          if (v == null) row[k] = null;
          else if (!trendRelative) row[k] = v;
          else {
            const r = ranges.get(k)!;
            row[k] = r.max === r.min ? 50 : Math.round(((v - r.min) / (r.max - r.min)) * 1000) / 10;
          }
        }
        return row;
      });
  }, [dayPoints, trendKeys, trendRelative]);

  const scatterData = useMemo(
    () => dayPoints.filter((p) => p[xField] != null && p[yField] != null).map((p) => ({ date: p.date, x: p[xField] as number, y: p[yField] as number })),
    [dayPoints, xField, yField]
  );
  const r = useMemo(() => pearson(scatterData.map((p) => [p.x, p.y] as [number, number])), [scatterData]);
  const rankedPairs = useMemo(() => allPairCorrelations(dayPoints), [dayPoints]);
  const fieldLabel = (k: string) => TREND_FIELDS.find((f) => f.key === k)?.label ?? k;

  // one combined lifts chart, standardized: each line = % of its target
  // (goal weight if set, else personal best), bodyweight = % of target weight
  const liftChart = useMemo(() => {
    const byExercise = new Map<string, Map<string, number>>();
    for (const l of lifts) {
      if (l.weightKg == null) continue;
      if (!byExercise.has(l.exercise)) byExercise.set(l.exercise, new Map());
      const m = byExercise.get(l.exercise)!;
      m.set(l.date, Math.max(m.get(l.date) ?? 0, l.weightKg));
    }
    const top = [...byExercise.entries()].sort(([, a], [, b]) => b.size - a.size).slice(0, 5);
    const series = top.map(([name, m]) => {
      const goal = goals.find((g) => !g.archived && g.unit === "kg" && g.exercise.toLowerCase() === name.toLowerCase());
      const denom = goal?.target ?? Math.max(...m.values());
      return { name, m, denom, hasGoal: !!goal };
    });
    const includeBw = targetWeight != null && bodyweight.size > 0;
    const dates = [...new Set([...top.flatMap(([, m]) => [...m.keys()]), ...(includeBw ? [...bodyweight.keys()] : [])])].sort();
    const data = dates.map((date) => {
      const row: Record<string, string | number | null> = { date };
      for (const s of series) {
        const v = s.m.get(date) ?? null;
        row[s.name] = v != null && s.denom > 0 ? Math.round((v / s.denom) * 1000) / 10 : null;
        row[`${s.name}__raw`] = v;
      }
      if (includeBw) {
        const bw = bodyweight.get(date) ?? null;
        row["Bodyweight"] = bw != null ? Math.round((bw / targetWeight!) * 1000) / 10 : null;
        row["Bodyweight__raw"] = bw;
      }
      return row;
    });
    const names = [...series.map((s) => ({ name: s.name, hasGoal: s.hasGoal })), ...(includeBw ? [{ name: "Bodyweight", hasGoal: true }] : [])];
    return { data, names };
  }, [lifts, goals, targetWeight, bodyweight]);

  // day metrics over time (all on the same /10-ish scale)
  const dayMetricData = useMemo(
    () =>
      dayPoints
        .filter((p) => DAY_METRIC_LINES.some((f) => p[f.key] != null))
        .map((p) => ({ date: p.date, ...Object.fromEntries(DAY_METRIC_LINES.map((f) => [f.key, p[f.key]])) })),
    [dayPoints]
  );

  if (loading) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Overview</h1>
        <button onClick={() => setCustomizing((v) => !v)} className="btn-ghost py-1.5">
          {customizing ? "Done" : "Customize"}
        </button>
      </div>
      {customizing && (
        <div className="card -mt-6 flex flex-wrap gap-2 p-3">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => toggleSection(s.key)}
              className={`rounded-full border px-3 py-1.5 text-sm ${sections[s.key] ? "bg-accent-soft font-semibold text-accent" : "text-muted"}`}
            >
              {sections[s.key] ? "✓ " : ""}{s.label}
            </button>
          ))}
        </div>
      )}

      {sections.ranking && (
        <section>
          <h2 className="mb-3 font-semibold">Productivity ranking</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {ranking.map((rk) => (
              <div key={rk.period} className="card p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">
                  {rk.period === "day" ? "Today" : rk.period === "week" ? `This week (from ${weekStart(todayISO).slice(5)})` : "All time"}
                </h3>
                <div className="mt-2 space-y-1 text-sm">
                  <p><span className="font-bold" style={{ color: colors.productive }}>{rk.totals.productive.toFixed(1)}h</span> productive</p>
                  <p><span className="font-bold" style={{ color: colors.brainrot }}>{rk.totals.brainrot.toFixed(1)}h</span> brainrot</p>
                  <p><span className="font-bold text-muted">{rk.totals.other.toFixed(1)}h</span> other</p>
                  <p className="pt-1 text-sm font-semibold">
                    Focus score: {rk.score === null ? "—" : rk.score}
                    <span className="ml-1 text-xs font-normal text-faint">/100</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {sections.hours && periodBuckets.length > 0 && (
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

      {sections.daymetrics && dayMetricData.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Day metrics</h2>
          <div className="h-64 card p-2">
            <ResponsiveContainer>
              <LineChart data={dayMetricData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
                <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
                <Tooltip labelFormatter={(d) => String(d)} />
                <Legend formatter={(v: string) => DAY_METRIC_LINES.find((f) => f.key === v)?.label ?? v} />
                {DAY_METRIC_LINES.map((f, i) => (
                  <Line key={f.key} type="monotone" strokeWidth={2.5} dataKey={f.key} name={f.label} stroke={TREND_COLORS[i % TREND_COLORS.length]} dot={false} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-xs text-faint">Emotion, tiredness, start friction and brain fatigue, all out of 10. Edit values on the Metrics tab.</p>
        </section>
      )}

      {sections.trends && (
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h2 className="font-semibold">Trends</h2>
            <label className="flex items-center gap-1.5 text-sm text-muted">
              <input type="checkbox" checked={trendRelative} onChange={(e) => setTrendRelative(e.target.checked)} />
              relative (each metric scaled to its own 0–100)
            </label>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {TREND_FIELDS.map((f, i) => (
              <button
                key={f.key}
                onClick={() => toggleTrendKey(f.key)}
                className={`rounded-full border px-3 py-1 text-xs ${trendKeys.includes(f.key) ? "font-semibold" : "text-muted"}`}
                style={trendKeys.includes(f.key) ? { borderColor: TREND_COLORS[i % TREND_COLORS.length], color: TREND_COLORS[i % TREND_COLORS.length] } : undefined}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="h-72 card p-2">
            {trendKeys.length === 0 || trendData.length === 0 ? (
              <p className="p-4 text-sm text-faint">Pick one or more metrics above.</p>
            ) : (
              <ResponsiveContainer>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
                  <YAxis tick={{ fontSize: 10 }} domain={trendRelative ? [0, 100] : ["auto", "auto"]} />
                  <Tooltip
                    formatter={(v: number, name: string, item: any) => {
                      const raw = item?.payload?.[`${name}__raw`];
                      return [raw != null ? Number(raw).toFixed(1) : v, fieldLabel(name)];
                    }}
                    labelFormatter={(d) => String(d)}
                  />
                  <Legend formatter={(v: string) => fieldLabel(String(v))} />
                  {trendKeys.map((k) => (
                    <Line
                      key={k}
                      type="monotone" strokeWidth={2.5}
                      dataKey={k}
                      stroke={TREND_COLORS[TREND_FIELDS.findIndex((f) => f.key === k) % TREND_COLORS.length]}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <p className="mt-1 text-xs text-faint">Hover shows real values; the lines are scaled so different units can share one chart.</p>
        </section>
      )}

      {sections.correlations && (
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

          {rankedPairs.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold">Every pair, ranked</h3>
              <p className="mb-2 text-xs text-muted">All metric pairs with 5+ shared days, strongest relationships first. Click a row to plot it above.</p>
              <div className="max-h-72 overflow-auto card">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2">Pair</th>
                      <th className="px-3 py-2">r</th>
                      <th className="px-3 py-2">Strength</th>
                      <th className="px-3 py-2">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankedPairs.map((p) => (
                      <tr
                        key={`${p.xKey}|${p.yKey}`}
                        onClick={() => {
                          setXField(p.xKey);
                          setYField(p.yKey);
                        }}
                        className={`cursor-pointer border-b last:border-0 hover:bg-surface-2 ${
                          (xField === p.xKey && yField === p.yKey) || (xField === p.yKey && yField === p.xKey) ? "bg-accent-soft" : ""
                        }`}
                      >
                        <td className="px-3 py-1.5">{fieldLabel(p.xKey)} × {fieldLabel(p.yKey)}</td>
                        <td className="px-3 py-1.5 font-mono tabular-nums" style={{ color: p.r > 0 ? colors.productive : colors.brainrot }}>
                          {p.r >= 0 ? "+" : ""}{p.r.toFixed(2)}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-muted">{describeR(p.r)}</td>
                        <td className="px-3 py-1.5 text-xs text-faint">{p.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {sections.lifts && liftChart.names.length > 0 && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-semibold">Lifts</h2>
            <Link href="/lifts" className="text-sm font-medium text-accent hover:underline">
              Per-exercise progression & bodyweight →
            </Link>
          </div>
          <div className="h-72 card p-2">
            <ResponsiveContainer>
              <LineChart data={liftChart.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
                <YAxis domain={[0, 110]} tick={{ fontSize: 10 }} unit="%" />
                <Tooltip
                  formatter={(v: number, name: string, item: any) => {
                    const raw = item?.payload?.[`${name}__raw`];
                    return [`${Number(v).toFixed(1)}% (${raw != null ? `${raw}kg` : "—"})`, name];
                  }}
                  labelFormatter={(d) => String(d)}
                />
                <Legend />
                {liftChart.names.map((n, i) => (
                  <Line key={n.name} type="monotone" strokeWidth={2.5} dataKey={n.name} stroke={TREND_COLORS[i % TREND_COLORS.length]} dot={{ r: 2 }} connectNulls strokeDasharray={n.hasGoal ? undefined : "5 3"} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-xs text-faint">
            Standardized: each line is % of its target — the lift&apos;s goal weight where one is set (solid), otherwise % of personal best (dashed).
            {targetWeight != null ? " Bodyweight is % of your target weight." : " Set a target weight in Settings to add bodyweight here."}
          </p>
        </section>
      )}
    </div>
  );
}
