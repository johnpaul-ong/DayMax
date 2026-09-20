"use client";

/**
 * Community-view helpers extracted from pursuits/[id]/page.tsx.
 * Everything here renders inside the Community tab for built-in
 * pursuits (Life, Lifts). Custom pursuits render StatSection per stat
 * instead and don't reach these components.
 *
 * Cluster:
 *   LifeCommunity        — 12-week board for the Life pursuit
 *   PeopleClocksGrid     — grid of one typical-day clock per member
 *   HoursLollipop        — lollipop chart of productive/brainrot hours
 *   Lollipop             — one row's rail+dot
 *   LiftsCommunity       — lift board with per-exercise trend
 *   LeaderCard           — small ranked list shared by both community views
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchPursuitDayTotals,
  fetchPursuitLifts,
  type DayStripRow,
  type LeaderboardLiftRow,
  type LeaderboardRow,
} from "@/lib/friends";
import { weekStart, workMaxFrom } from "@/lib/ranking";
import { localToday } from "@/lib/dates";
import { CHART_DANGER, chartSeries } from "@/lib/chartColors";
import DayClock, { type ClockSlot } from "../../day-clock";

const tickDate = (d: string) => (typeof d === "string" ? d.slice(5) : d);

/**
 * The Life pursuit's community board: everyone's focus score and hours.
 * Built from leaderboard_day_totals — the same share-rule-enforcing function
 * the Arena uses, so nobody who set themselves to hidden ever shows up.
 */
export function LifeCommunity({ pursuitId, memberCount }: { pursuitId: string; memberCount: number }) {
  const todayISO = localToday();
  const ws = weekStart(todayISO);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  const since = useMemo(() => {
    const d = new Date(todayISO + "T00:00:00");
    d.setDate(d.getDate() - 84);
    return localToday(d);
  }, [todayISO]);

  useEffect(() => {
    fetchPursuitDayTotals(pursuitId, since, todayISO)
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [pursuitId, since, todayISO]);

  const people = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; rows: LeaderboardRow[] }>();
    for (const r of rows) {
      if (!byId.has(r.memberId)) byId.set(r.memberId, { id: r.memberId, name: r.displayName, rows: [] });
      byId.get(r.memberId)!.rows.push(r);
    }
    const score = (list: LeaderboardRow[]) => {
      const p = list.reduce((s, r) => s + r.productive, 0);
      const b = list.reduce((s, r) => s + r.brainrot, 0);
      return p + b > 0 ? Math.round((p / (p + b)) * 1000) / 10 : null;
    };
    return [...byId.values()].map((m) => {
      const week = m.rows.filter((r) => r.date >= ws && r.date <= todayISO);
      const weekP = week.reduce((s, r) => s + r.productive, 0);
      const weekB = week.reduce((s, r) => s + r.brainrot, 0);
      const allP = m.rows.reduce((s, r) => s + r.productive, 0);
      const allB = m.rows.reduce((s, r) => s + r.brainrot, 0);
      return {
        id: m.id,
        name: m.name,
        weekScore: score(week),
        weekP,
        weekB,
        allP,
        allScore: score(m.rows),
        weekWorkMax: workMaxFrom(weekP, weekB),
        allWorkMax: workMaxFrom(allP, allB),
        days: new Set(m.rows.map((r) => r.date)).size,
      };
    });
  }, [rows, ws, todayISO]);

  const topWeek = useMemo(
    () => [...people].filter((p) => p.weekWorkMax != null).sort((a, b) => (b.weekWorkMax ?? 0) - (a.weekWorkMax ?? 0)).slice(0, 5),
    [people]
  );
  const topAllTime = useMemo(() => [...people].sort((a, b) => (b.allWorkMax ?? 0) - (a.allWorkMax ?? 0)).slice(0, 5), [people]);

  const chart = useMemo(() => {
    const names = topWeek.map((p) => p.name);
    const keep = new Set(topWeek.map((p) => p.id));
    const byDate = new Map<string, Record<string, string | number | null>>();
    for (const r of rows) {
      if (!keep.has(r.memberId)) continue;
      if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date });
      const scored = r.productive + r.brainrot;
      byDate.get(r.date)![r.displayName] = scored > 0 ? Math.round((r.productive / scored) * 1000) / 10 : null;
    }
    return { data: [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1)).slice(-42), names };
  }, [rows, topWeek]);

  const totals = useMemo(() => {
    const p = rows.reduce((s, r) => s + r.productive, 0);
    const b = rows.reduce((s, r) => s + r.brainrot, 0);
    return { p, b, days: new Set(rows.map((r) => r.date)).size };
  }, [rows]);

  if (loading) return <p className="text-sm text-muted">Loading the community…</p>;
  if (people.length === 0) return <p className="card p-4 text-sm text-faint">Nobody is sharing their day yet.</p>;

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-faint">Logging (12wk)</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{people.length}</p>
          <p className="mt-0.5 text-xs text-muted">of {memberCount} members</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-faint">Days logged (12wk)</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{totals.days.toLocaleString()}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-faint">Productive hours</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{Math.round(totals.p).toLocaleString()}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-faint">Brainrot hours</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{Math.round(totals.b).toLocaleString()}</p>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <LeaderCard
          title="Top this week"
          subtitle="WorkMax — focus score × hours since Monday"
          rows={topWeek.map((p) => ({
            id: p.id,
            name: p.name,
            value: `${p.weekWorkMax}`,
            sub: `${p.weekP.toFixed(1)}h productive · focus ${p.weekScore ?? "—"}`,
          }))}
        />
        <LeaderCard
          title="Last 12 weeks"
          subtitle="WorkMax over the recent stretch"
          rows={topAllTime.map((p) => ({
            id: p.id,
            name: p.name,
            value: `${p.allWorkMax?.toFixed(0) ?? "—"}`,
            sub: `${p.allP.toFixed(0)}h productive · focus ${p.allScore ?? "—"}`,
          }))}
        />
      </section>

      <PeopleClocksGrid members={people.slice(0, 8).map((p) => ({ id: p.id, name: p.name }))} />

      {chart.data.length > 1 && (
        <section>
          <h2 className="mb-1 font-semibold">Daily focus score</h2>
          <p className="mb-2 text-sm text-muted">This week&apos;s leaders, last six weeks. Focus score = productive ÷ (productive + brainrot) × 100.</p>
          <div className="h-64 card p-2">
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
        </section>
      )}

      <section>
        <h2 className="mb-1 font-semibold">Hours this week</h2>
        <HoursLollipop rows={[...people].sort((a, b) => b.weekP - a.weekP).slice(0, 8).map((p) => ({ name: p.name, productive: Math.round(p.weekP * 10) / 10, brainrot: Math.round(p.weekB * 10) / 10 }))} />
      </section>
    </>
  );
}

/**
 * One typical-day clock per member, side-by-side. Same rule as the
 * hero on Community: every logged day collapsed onto a single dial.
 */
function PeopleClocksGrid({ members }: { members: Array<{ id: string; name: string }> }) {
  const [strips, setStrips] = useState<Map<string, DayStripRow[]>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { fetchMemberDayStrip } = await import("@/lib/friends");
      const results = await Promise.all(
        members.map(async (m) => {
          try {
            const rs = await fetchMemberDayStrip(m.id);
            return [m.id, rs] as const;
          } catch {
            return [m.id, [] as DayStripRow[]] as const;
          }
        })
      );
      if (!alive) return;
      setStrips(new Map(results));
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [members]);

  if (!loaded) return null;
  const withData = members.filter((m) => (strips.get(m.id)?.length ?? 0) > 0);
  if (withData.length === 0) return null;

  return (
    <section>
      <h2 className="mb-1 font-semibold">Everyone&apos;s typical day</h2>
      <p className="mb-2 text-sm text-muted">One dial per person — every day they&apos;ve logged, collapsed onto a clock. Neighbours show whose days rhyme.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {withData.map((m) => {
          const strip = strips.get(m.id)!;
          const perSlot = new Map<number, Map<number, number>>();
          for (const r of strip) {
            if (!perSlot.has(r.slot)) perSlot.set(r.slot, new Map());
            const mm = perSlot.get(r.slot)!;
            mm.set(r.category, (mm.get(r.category) ?? 0) + 1);
          }
          const clockSlots = new Map<number, ClockSlot>();
          for (const [slot, counts] of perSlot) {
            const [cat] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
            clockSlots.set(slot, { category: cat });
          }
          const days = new Set(strip.map((r) => r.date)).size;
          return (
            <div key={m.id} className="card p-2">
              <div className="mb-1 flex items-baseline justify-between gap-1">
                <p className="truncate text-xs font-semibold">{m.name}</p>
                <p className="shrink-0 text-[9px] text-faint">{days}d</p>
              </div>
              <div className="mx-auto max-w-[160px]">
                <DayClock slots={clockSlots} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Lollipop plot: name on the left, two thin rails (productive +
 * brainrot) with a dot at the end of each.
 */
function HoursLollipop({ rows }: { rows: Array<{ name: string; productive: number; brainrot: number }> }) {
  if (rows.length === 0) return <p className="card p-4 text-sm text-faint">Nothing logged this week yet.</p>;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.productive, r.brainrot)));
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--accent)" }} /> productive</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: CHART_DANGER }} /> brainrot</span>
        <span className="ml-auto text-faint tabular-nums">scale 0 – {Math.ceil(max)}h</span>
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.name} className="grid grid-cols-[7rem_1fr] items-center gap-3">
            <p className="truncate text-sm font-medium">{r.name}</p>
            <div className="space-y-1.5">
              <Lollipop value={r.productive} max={max} color="var(--accent)" />
              <Lollipop value={r.brainrot} max={max} color={CHART_DANGER} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Lollipop({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(0.5, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-3 flex-1">
        <div className="absolute top-1/2 h-[2px] -translate-y-1/2 rounded-full" style={{ width: `${pct}%`, background: color, opacity: 0.55 }} />
        <div className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full" style={{ left: `calc(${pct}% - 6px)`, background: color, boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
      </div>
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted">{value.toFixed(1)}h</span>
    </div>
  );
}

/** The Lifts pursuit's community board: who lifts what, and how it's moving. */
export function LiftsCommunity({ pursuitId }: { pursuitId: string }) {
  const [rows, setRows] = useState<LeaderboardLiftRow[]>([]);
  const [exercise, setExercise] = useState("");
  const [loading, setLoading] = useState(true);

  const since = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return localToday(d);
  }, []);

  useEffect(() => {
    fetchPursuitLifts(pursuitId, since)
      .then((rs) => {
        setRows(rs);
        if (rs.length) {
          const counts = new Map<string, number>();
          for (const r of rs) counts.set(r.exercise, (counts.get(r.exercise) ?? 0) + 1);
          setExercise([...counts.entries()].sort(([, a], [, b]) => b - a)[0][0]);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [pursuitId, since]);

  const exercises = useMemo(() => [...new Set(rows.map((r) => r.exercise))].sort(), [rows]);

  const board = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; best: number; latest: number; sessions: number; first: number }>();
    const sorted = [...rows].filter((r) => r.exercise === exercise).sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const r of sorted) {
      const cur = byId.get(r.memberId) ?? { id: r.memberId, name: r.displayName, best: 0, latest: r.weightKg, sessions: 0, first: r.weightKg };
      cur.best = Math.max(cur.best, r.weightKg);
      cur.latest = r.weightKg;
      cur.sessions += 1;
      byId.set(r.memberId, cur);
    }
    return [...byId.values()].sort((a, b) => b.best - a.best).slice(0, 5);
  }, [rows, exercise]);

  const chart = useMemo(() => {
    const byDate = new Map<string, Record<string, string | number | null>>();
    const names = new Set<string>();
    for (const r of rows) {
      if (r.exercise !== exercise) continue;
      names.add(r.displayName);
      if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date });
      const row = byDate.get(r.date)!;
      row[r.displayName] = Math.max(Number(row[r.displayName] ?? 0), r.weightKg);
    }
    return { data: [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1)), names: [...names] };
  }, [rows, exercise]);

  if (loading) return <p className="text-sm text-muted">Loading the community…</p>;
  if (rows.length === 0) return <p className="card p-4 text-sm text-faint">Nobody is sharing lifts yet.</p>;

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-faint">Lifters</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{new Set(rows.map((r) => r.memberId)).size}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-faint">Exercises tracked</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{exercises.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-faint">Sessions logged</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{rows.length.toLocaleString()}</p>
        </div>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Leaderboard</h2>
          <select value={exercise} onChange={(e) => setExercise(e.target.value)} className="rounded-lg border bg-surface px-2 py-1 text-sm">
            {exercises.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </div>
        <LeaderCard
          title={exercise}
          subtitle="Heaviest lifted, and where they are now"
          rows={board.map((b) => ({
            id: b.id,
            name: b.name,
            value: `${b.best}kg`,
            sub: `${b.sessions} session${b.sessions === 1 ? "" : "s"} · now ${b.latest}kg`,
          }))}
        />
      </section>

      {chart.data.length > 1 && (
        <section>
          <h2 className="mb-2 font-semibold">{exercise} over time</h2>
          <div className="h-64 card p-2">
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
        </section>
      )}
    </>
  );
}

/** Small ranked list with names that link through to profiles. */
function LeaderCard({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ id: string; name: string; value: string; sub: string }>;
}) {
  return (
    <div className="card p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="mb-2 text-xs text-muted">{subtitle}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-faint">Nobody qualifies yet.</p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <span className="w-5 text-center font-semibold text-faint">{i + 1}</span>
              <Link href={`/friends/${r.id}`} className="font-medium hover:text-accent hover:underline">{r.name}</Link>
              <span className="ml-auto text-right">
                <span className="block font-semibold tabular-nums">{r.value}</span>
                <span className="block text-[10px] text-faint">{r.sub}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
