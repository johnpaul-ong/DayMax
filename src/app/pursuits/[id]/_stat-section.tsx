"use client";

/**
 * StatSection: a custom pursuit stat's community board.
 *
 * Extracted from the previously 2 000-line page.tsx. Used from both
 * the Community view (parent renders one per visible stat) and from
 * MyStat inside the Mine view (which passes `mineOnly` so the community
 * chart + table hide, leaving just the logging form and private notes).
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useMemo, useState } from "react";
import {
  deleteStat,
  fetchMyEntries,
  fetchStatData,
  logEntry,
  updateStat,
  type MyEntry,
  type PursuitStat,
  type StatEntry,
} from "@/lib/pursuits";
import { weekStart } from "@/lib/ranking";
import { localToday } from "@/lib/dates";
import { CHART_OK, chartSeries } from "@/lib/chartColors";

const tickDate = (d: string) => (typeof d === "string" ? d.slice(5) : d);

export default function StatSection({
  stat,
  isOwner,
  isMember,
  onChanged,
  mineOnly,
}: {
  stat: PursuitStat;
  isOwner: boolean;
  isMember: boolean;
  onChanged: () => void;
  mineOnly?: boolean;
}) {
  const todayISO = localToday();
  const ws = weekStart(todayISO);
  const [all, setAll] = useState<StatEntry[]>([]);
  const [mine, setMine] = useState<MyEntry[]>([]);
  const [date, setDate] = useState(todayISO);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reload() {
    fetchStatData(stat.id).then(setAll).catch(() => {});
    fetchMyEntries(stat.id).then(setMine).catch(() => {});
  }
  useEffect(reload, [stat.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lineData = useMemo(() => {
    const byDate = new Map<string, Record<string, string | number | null>>();
    const names = new Set<string>();
    for (const e of all) {
      names.add(e.displayName);
      if (!byDate.has(e.date)) byDate.set(e.date, { date: e.date });
      byDate.get(e.date)![e.displayName] = e.value;
    }
    return { data: [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1)), names: [...names].sort() };
  }, [all]);

  const perMember = useMemo(() => {
    const byMember = new Map<string, { name: string; rows: StatEntry[] }>();
    for (const e of all) {
      if (!byMember.has(e.memberId)) byMember.set(e.memberId, { name: e.displayName, rows: [] });
      byMember.get(e.memberId)!.rows.push(e);
    }
    return [...byMember.values()].map((m) => {
      const vals = m.rows.map((r) => r.value);
      const week = m.rows.filter((r) => r.date >= ws && r.date <= todayISO).reduce((s, r) => s + r.value, 0);
      const sorted = [...m.rows].sort((a, b) => (a.date < b.date ? -1 : 1));
      return {
        name: m.name,
        today: m.rows.find((r) => r.date === todayISO)?.value ?? null,
        week,
        total: vals.reduce((s, v) => s + v, 0),
        best: stat.direction === "more" ? Math.max(...vals) : Math.min(...vals),
        latest: sorted[sorted.length - 1]?.value ?? null,
      };
    });
  }, [all, stat.direction, todayISO, ws]);

  const board = useMemo(
    () =>
      [...perMember].sort((a, b) =>
        stat.cadence === "daily" ? b.week - a.week : stat.direction === "more" ? (b.latest ?? -Infinity) - (a.latest ?? -Infinity) : (a.latest ?? Infinity) - (b.latest ?? Infinity)
      ),
    [perMember, stat]
  );

  const notes = mine.filter((m) => m.note).slice(0, 8);

  return (
    <section className={`card p-4 ${stat.hidden ? "opacity-60" : ""}`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="font-semibold">{stat.name} {stat.hidden && <span className="text-xs font-normal text-warn">(hidden — only you see this)</span>}</h2>
        <span className="text-xs text-faint">
          {stat.unit && `${stat.unit} · `}{stat.cadence === "daily" ? "daily" : "log whenever"} · {stat.direction === "more" ? "more is better" : "less is better"}
          {stat.target != null && ` · target ${stat.target}`}
        </span>
        {isOwner && (
          <span className="ml-auto inline-flex items-center gap-2 text-xs">
            <select value={stat.chart} onChange={(e) => void updateStat(stat.id, { chart: e.target.value as any }).then(onChanged)} className="rounded-lg border bg-surface px-1.5 py-0.5">
              <option value="line">line</option>
              <option value="bar">bar</option>
              <option value="pie">pie</option>
            </select>
            <button onClick={() => void updateStat(stat.id, { hidden: !stat.hidden }).then(onChanged)} className="text-accent hover:underline">
              {stat.hidden ? "show" : "hide"}
            </button>
            <button onClick={() => void deleteStat(stat.id).then(onChanged)} className="text-danger hover:opacity-70">remove</button>
          </span>
        )}
      </div>

      {isMember && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border bg-surface px-2 py-2 text-sm" />
          <input type="number" step="any" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={stat.unit || "value"} className="w-28 rounded-lg border bg-surface px-2 py-2 text-sm" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (private)" className="min-w-56 flex-1 rounded-lg border bg-surface px-2 py-2 text-sm" />
          <button
            onClick={() => {
              const v = Number(value);
              if (!Number.isFinite(v)) return;
              void logEntry(stat.id, date, v, note.trim() || null)
                .then(() => { setValue(""); setNote(""); setSaved(true); setTimeout(() => setSaved(false), 2000); reload(); })
                .catch((e) => setErr(String(e.message ?? e)));
            }}
            disabled={value.trim() === ""}
            className="btn-primary"
          >
            Log
          </button>
          {saved && <span className="text-sm font-medium text-ok">Saved ✓</span>}
        </div>
      )}
      {err && <p className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}

      {!mineOnly && all.length > 0 && (
        <div className="mb-3 h-52">
          <ResponsiveContainer>
            {stat.chart === "pie" ? (
              <PieChart>
                <Pie
                  data={perMember.map((m) => ({ name: m.name, value: Math.round((stat.cadence === "daily" ? m.total : m.latest ?? 0) * 100) / 100 }))}
                  dataKey="value"
                  nameKey="name"
                  label={(p: any) => `${p.name} (${p.value})`}
                >
                  {perMember.map((_, i) => (
                    <Cell key={i} fill={chartSeries(i)} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            ) : stat.chart === "bar" ? (
              <BarChart data={perMember.map((m) => ({ name: m.name, thisWeek: Math.round(m.week * 100) / 100, best: m.best }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="thisWeek" fill="var(--accent)" />
                <Bar dataKey="best" fill={CHART_OK} />
              </BarChart>
            ) : (
              <LineChart data={lineData.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
                <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                <Tooltip labelFormatter={(d) => String(d)} />
                {lineData.names.length > 1 && <Legend />}
                {stat.target != null && <ReferenceLine y={stat.target} strokeDasharray="6 3" stroke="var(--accent)" label={{ value: `target ${stat.target}`, fontSize: 10 }} />}
                {lineData.names.map((n, i) => (
                  <Line key={n} type="monotone" strokeWidth={2.5} dataKey={n} stroke={chartSeries(i)} dot={{ r: 2 }} connectNulls />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      {!mineOnly && board.length > 0 && (
        <div className="mb-3 overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-1.5">#</th>
                <th className="px-3 py-1.5">Member</th>
                <th className="px-3 py-1.5">Today</th>
                <th className="px-3 py-1.5">This week</th>
                <th className="px-3 py-1.5">{stat.cadence === "daily" ? "All time" : "Latest"}</th>
                <th className="px-3 py-1.5">Best</th>
              </tr>
            </thead>
            <tbody>
              {board.map((m, i) => (
                <tr key={m.name} className="border-b last:border-0">
                  <td className="px-3 py-1.5 font-semibold text-faint">{i + 1}</td>
                  <td className="px-3 py-1.5 font-medium">{m.name}</td>
                  <td className="px-3 py-1.5 tabular-nums">{m.today ?? "—"}</td>
                  <td className="px-3 py-1.5 tabular-nums">{stat.cadence === "daily" ? m.week.toFixed(0) : "—"}</td>
                  <td className="px-3 py-1.5 tabular-nums">{stat.cadence === "daily" ? Math.round(m.total).toLocaleString() : m.latest ?? "—"}</td>
                  <td className="px-3 py-1.5 tabular-nums">{m.best}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {notes.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Your notes <span className="font-normal text-faint">(only you see these)</span></h3>
          {notes.map((n) => (
            <p key={n.date} className="py-0.5 text-sm text-muted">
              <span className="font-mono text-xs text-faint">{n.date}</span> · <b>{n.value}</b> {stat.unit} — {n.note}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
