"use client";

/**
 * The Compare panels shown inside a track: a day-grid track compares
 * on focus / WorkMax; a lifts track compares on weight per exercise.
 *
 * Extracted from page.tsx unchanged.
 */

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  fetchCompareDay,
  fetchCompareLifts,
  type CompareDayRow,
  type CompareLiftRow,
} from "@/lib/friends";
import { weekStart, workMaxFrom } from "@/lib/ranking";
import { DEFAULT_BUCKET_COLORS, loadBucketColors, type BucketColors } from "@/lib/theme";
import { chartSeries } from "@/lib/chartColors";
import { localToday } from "@/lib/dates";

const tickDate = (d: string) => (typeof d === "string" ? d.slice(5) : d);

export function DayCompare({ trackId }: { trackId: string }) {
  const todayISO = localToday();
  const ws = weekStart(todayISO);
  const [rows, setRows] = useState<CompareDayRow[]>([]);
  const [colors, setColors] = useState<BucketColors>(DEFAULT_BUCKET_COLORS);

  useEffect(() => {
    setColors(loadBucketColors());
    fetchCompareDay(trackId).then(setRows).catch(() => {});
  }, [trackId]);

  const board = useMemo(() => {
    const byMember = new Map<string, { name: string; rows: CompareDayRow[] }>();
    for (const r of rows) {
      if (!byMember.has(r.memberId)) byMember.set(r.memberId, { name: r.displayName, rows: [] });
      byMember.get(r.memberId)!.rows.push(r);
    }
    const agg = (list: CompareDayRow[]) => {
      const p = list.reduce((s, r) => s + r.productive, 0);
      const b = list.reduce((s, r) => s + r.brainrot, 0);
      const o = list.reduce((s, r) => s + r.other, 0);
      return {
        p,
        b,
        o,
        score: p + b > 0 ? Math.round((p / (p + b)) * 1000) / 10 : null,
        workMax: workMaxFrom(p, b),
      };
    };
    return [...byMember.entries()]
      .map(([id, m]) => ({
        id,
        name: m.name,
        today: agg(m.rows.filter((r) => r.date === todayISO)),
        week: agg(m.rows.filter((r) => r.date >= ws && r.date <= todayISO)),
        all: agg(m.rows),
      }))
      .sort((a, b) => (b.week.workMax ?? -1) - (a.week.workMax ?? -1))
      .slice(0, 5);
  }, [rows, todayISO, ws]);

  const chart = useMemo(() => {
    const byDate = new Map<string, Record<string, string | number | null>>();
    const names = new Set<string>();
    for (const r of rows) {
      names.add(r.displayName);
      if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date });
      const scored = r.productive + r.brainrot;
      byDate.get(r.date)![r.displayName] = scored > 0 ? Math.round((r.productive / scored) * 1000) / 10 : null;
    }
    return { data: [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1)).slice(-42), names: [...names] };
  }, [rows]);

  if (rows.length === 0) return <p className="text-sm text-faint">No shared data yet — Compare fills in once members log days.</p>;

  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">Top 5 (ranked by this week&apos;s WorkMax)</h3>
      <p className="mb-1 text-xs text-faint">
        <b>WorkMax</b> = focus ÷ 100 × productive hours, so quality and quantity both count. <b>Focus</b> = productive ÷
        (productive + brainrot) × 100 on its own, which stays high on a light day — hours are shown next to both.
      </p>
      <div className="mb-3 overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Member</th>
              <th className="px-3 py-2">Today</th>
              <th className="px-3 py-2">This week</th>
              <th className="px-3 py-2">All time</th>
            </tr>
          </thead>
          <tbody>
            {board.map((m, i) => (
              <tr key={m.id} className="border-b last:border-0">
                <td className="px-3 py-1.5 font-bold text-faint">{i + 1}</td>
                <td className="px-3 py-1.5 font-medium">{m.name}</td>
                {[m.today, m.week, m.all].map((a, j) => (
                  <td key={j} className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                    <span className="font-semibold">{a.workMax ?? "—"}</span>
                    <span className="ml-1 text-xs text-faint">
                      focus {a.score ?? "—"} · (<span style={{ color: colors.productive }}>{a.p.toFixed(1)}</span>/<span style={{ color: colors.brainrot }}>{a.b.toFixed(1)}</span>/<span className="text-muted">{a.o.toFixed(1)}</span>h)
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mb-2 text-xs text-faint">Score and hours shown together so nobody can game one stat.</p>

      <h4 className="mb-1 text-sm font-semibold">Daily focus score (/100)</h4>
      <div className="h-56 card p-2">
        <ResponsiveContainer>
          <LineChart data={chart.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
            <Tooltip labelFormatter={(d) => String(d)} />
            <Legend />
            {chart.names.map((n, i) => (
              <Line key={n} type="monotone" strokeWidth={2.5} dataKey={n} stroke={chartSeries(i)} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function LiftsCompare({ trackId }: { trackId: string }) {
  const [rows, setRows] = useState<CompareLiftRow[]>([]);
  const [exercise, setExercise] = useState<string>("");

  useEffect(() => {
    fetchCompareLifts(trackId)
      .then((rs) => {
        setRows(rs);
        if (rs.length && !exercise) {
          const counts = new Map<string, number>();
          for (const r of rs) counts.set(r.exercise, (counts.get(r.exercise) ?? 0) + 1);
          setExercise([...counts.entries()].sort(([, a], [, b]) => b - a)[0][0]);
        }
      })
      .catch(() => {});
  }, [trackId]); // eslint-disable-line react-hooks/exhaustive-deps

  const exercises = useMemo(() => [...new Set(rows.map((r) => r.exercise))].sort(), [rows]);

  const chart = useMemo(() => {
    const filtered = rows.filter((r) => r.exercise === exercise && r.weightKg != null);
    const byDate = new Map<string, Record<string, string | number | null>>();
    const names = new Set<string>();
    for (const r of filtered) {
      names.add(r.displayName);
      if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date });
      const row = byDate.get(r.date)!;
      row[r.displayName] = Math.max(Number(row[r.displayName] ?? 0), r.weightKg!);
    }
    return { data: [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1)), names: [...names] };
  }, [rows, exercise]);

  const board = useMemo(() => {
    const byMember = new Map<string, { name: string; best: number; latest: number }>();
    for (const r of rows) {
      if (r.exercise !== exercise || r.weightKg == null) continue;
      const cur = byMember.get(r.memberId) ?? { name: r.displayName, best: 0, latest: r.weightKg };
      cur.best = Math.max(cur.best, r.weightKg);
      cur.latest = r.weightKg;
      byMember.set(r.memberId, cur);
    }
    return [...byMember.values()].sort((a, b) => b.best - a.best).slice(0, 5);
  }, [rows, exercise]);

  if (rows.length === 0) return <p className="text-sm text-faint">No shared lifts yet.</p>;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold">Lift compare</h3>
        <select value={exercise} onChange={(e) => setExercise(e.target.value)} className="rounded-lg border bg-surface px-2 py-1 text-sm">
          {exercises.map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </select>
      </div>
      <div className="h-56 card p-2">
        <ResponsiveContainer>
          <LineChart data={chart.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
            <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} unit="kg" />
            <Tooltip labelFormatter={(d) => String(d)} />
            <Legend />
            {chart.names.map((n, i) => (
              <Line key={n} type="monotone" strokeWidth={2.5} dataKey={n} stroke={chartSeries(i)} dot={{ r: 2 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {board.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-1.5">#</th>
                <th className="px-3 py-1.5">Member</th>
                <th className="px-3 py-1.5">Best</th>
                <th className="px-3 py-1.5">Latest</th>
              </tr>
            </thead>
            <tbody>
              {board.map((m, i) => (
                <tr key={m.name} className="border-b last:border-0">
                  <td className="px-3 py-1.5 font-semibold text-faint">{i + 1}</td>
                  <td className="px-3 py-1.5 font-medium">{m.name}</td>
                  <td className="px-3 py-1.5 tabular-nums">{m.best}kg</td>
                  <td className="px-3 py-1.5 tabular-nums">{m.latest}kg</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
