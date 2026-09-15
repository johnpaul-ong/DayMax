"use client";

/**
 * The Arena had no charts at all — five ranked tables of numbers, which is a
 * spreadsheet with a scoreboard font. The data was already there; nothing
 * drew it.
 *
 * Four views, each answering a question a table cannot:
 *   Race         — who overtook whom, and when
 *   Spread       — is 4th place just behind, or nowhere near
 *   Day shape    — what these people's days actually look like next to mine
 *   Head to head — one rival, every category, and the last fortnight
 */

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LeaderboardRow } from "@/lib/friends";
import { workMaxFrom } from "@/lib/ranking";
import { teamMeta } from "@/lib/teams";

const tick = (d: string) => (typeof d === "string" ? d.slice(5) : d);
/** Highest-contrast set that still reads on both themes. */
const SERIES = ["#4f6ef7", "#16a34a", "#dc2626", "#f59e0b", "#0ea5e9", "#a78bfa", "#ec4899", "#14b8a6"];

interface Person {
  id: string;
  name: string;
  team: string;
  productive: number;
  brainrot: number;
  social: number;
  other: number;
  days: number;
}

function peopleFrom(rows: LeaderboardRow[]): Person[] {
  const m = new Map<string, Person>();
  for (const r of rows) {
    const p =
      m.get(r.memberId) ??
      { id: r.memberId, name: r.displayName, team: r.team, productive: 0, brainrot: 0, social: 0, other: 0, days: 0 };
    p.productive += r.productive;
    p.brainrot += r.brainrot;
    p.social += r.social;
    p.other += r.other;
    p.days += 1;
    m.set(r.memberId, p);
  }
  return [...m.values()];
}

function lastNDates(rows: LeaderboardRow[], n: number): string[] {
  return [...new Set(rows.map((r) => r.date))].sort().slice(-n);
}

export default function ArenaCharts({ rows, me }: { rows: LeaderboardRow[]; me: string | null }) {
  const [view, setView] = useState<"race" | "spread" | "shape" | "h2h">("race");
  const people = useMemo(() => peopleFrom(rows), [rows]);

  if (rows.length === 0) return null;

  const VIEWS = [
    { key: "race" as const, label: "Race", hint: "Who pulled ahead, and when" },
    { key: "spread" as const, label: "Spread", hint: "Where you sit in the pack" },
    { key: "shape" as const, label: "Day shape", hint: "What their days look like" },
    { key: "h2h" as const, label: "Head to head", hint: "You vs one person" },
  ];

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">The picture</h2>
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              title={v.hint}
              className={`rounded-lg px-3 py-1 ${view === v.key ? "bg-surface font-semibold text-ink" : "text-muted hover:text-ink"}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {view === "race" && <Race rows={rows} me={me} />}
      {view === "spread" && <Spread people={people} me={me} />}
      {view === "shape" && <DayShape people={people} me={me} />}
      {view === "h2h" && <HeadToHead rows={rows} people={people} me={me} />}
    </section>
  );
}

/** Cumulative productive hours over the last 30 days. The overtakes are the point. */
function Race({ rows, me }: { rows: LeaderboardRow[]; me: string | null }) {
  const dates = useMemo(() => lastNDates(rows, 30), [rows]);
  const top = useMemo(() => {
    const totals = peopleFrom(rows.filter((r) => dates.includes(r.date)));
    return totals.sort((a, b) => b.productive - a.productive).slice(0, 8);
  }, [rows, dates]);

  const data = useMemo(() => {
    const byKey = new Map(rows.map((r) => [`${r.memberId}|${r.date}`, r]));
    const running = new Map(top.map((p) => [p.id, 0]));
    return dates.map((date) => {
      const point: Record<string, string | number> = { date };
      for (const p of top) {
        running.set(p.id, (running.get(p.id) ?? 0) + (byKey.get(`${p.id}|${date}`)?.productive ?? 0));
        point[p.name] = Math.round((running.get(p.id) ?? 0) * 10) / 10;
      }
      return point;
    });
  }, [rows, dates, top]);

  const leader = top[0];
  const mine = top.find((p) => p.id === me);

  return (
    <>
      <p className="mb-2 text-sm text-muted">
        Productive hours added up over the last {dates.length} days.{" "}
        {leader && (
          <>
            <b>{leader.name}</b> leads on {Math.round(leader.productive)}h
            {mine && mine.id !== leader.id && <> — you&apos;re {Math.round(leader.productive - mine.productive)}h back</>}
            {mine && mine.id === leader.id && <> — that&apos;s you</>}.
          </>
        )}
      </p>
      <div className="h-72 card p-2">
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={tick} />
            <YAxis tick={{ fontSize: 10 }} unit="h" />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {top.map((p, i) => (
              <Line
                key={p.id}
                type="monotone"
                dataKey={p.name}
                stroke={p.id === me ? "var(--accent)" : SERIES[i % SERIES.length]}
                strokeWidth={p.id === me ? 3.5 : 1.75}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/** A rank of 4th tells you nothing about whether 4th is close. This does. */
function Spread({ people, me }: { people: Person[]; me: string | null }) {
  const scored = useMemo(
    () =>
      people
        .filter((p) => p.days > 0)
        .map((p) => ({ ...p, perDay: p.productive / p.days }))
        .sort((a, b) => b.perDay - a.perDay),
    [people]
  );
  const mine = scored.find((p) => p.id === me);
  const rank = mine ? scored.indexOf(mine) + 1 : null;
  const median = scored.length ? scored[Math.floor(scored.length / 2)].perDay : 0;

  return (
    <>
      <p className="mb-2 text-sm text-muted">
        Productive hours a day, everyone in the scope, best first.{" "}
        {mine ? (
          <>
            You&apos;re <b>#{rank} of {scored.length}</b> on {mine.perDay.toFixed(1)}h — the median is {median.toFixed(1)}h,
            the leader {scored[0].perDay.toFixed(1)}h.
          </>
        ) : (
          <>Log a day to appear here.</>
        )}
      </p>
      <div className="h-72 card p-2">
        <ResponsiveContainer>
          <BarChart data={scored.map((p) => ({ name: p.name, perDay: Math.round(p.perDay * 10) / 10, id: p.id }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 10 }} unit="h" />
            <Tooltip formatter={(v: number) => [`${v}h a day`, "productive"]} />
            <ReferenceLine y={median} stroke="var(--muted)" strokeDasharray="5 4" label={{ value: "median", fontSize: 10, fill: "var(--muted)" }} />
            <Bar dataKey="perDay" radius={[3, 3, 0, 0]}>
              {scored.map((p) => (
                <Cell key={p.id} fill={p.id === me ? "var(--accent)" : teamMeta(p.team).color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/** Same 24 hours, spent very differently. */
function DayShape({ people, me }: { people: Person[]; me: string | null }) {
  const data = useMemo(
    () =>
      people
        .filter((p) => p.days > 0)
        .map((p) => ({
          name: p.name,
          id: p.id,
          productive: Math.round((p.productive / p.days) * 10) / 10,
          social: Math.round((p.social / p.days) * 10) / 10,
          brainrot: Math.round((p.brainrot / p.days) * 10) / 10,
          other: Math.round((p.other / p.days) * 10) / 10,
        }))
        .sort((a, b) => b.productive - a.productive)
        .slice(0, 12),
    [people]
  );
  const mine = data.find((p) => p.id === me);
  const most = [...data].sort((a, b) => b.brainrot - a.brainrot)[0];

  return (
    <>
      <p className="mb-2 text-sm text-muted">
        An average day each, split four ways.{" "}
        {mine && <>Yours is {mine.productive}h productive and {mine.brainrot}h brainrot. </>}
        {most && <><b>{most.name}</b> loses the most to brainrot at {most.brainrot}h a day.</>}
      </p>
      <div className="h-80 card p-2">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" tick={{ fontSize: 10 }} unit="h" />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={92} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="productive" stackId="a" fill="#16a34a" />
            <Bar dataKey="social" stackId="a" fill="#f59e0b" />
            <Bar dataKey="brainrot" stackId="a" fill="#dc2626" />
            <Bar dataKey="other" stackId="a" fill="#94a3b8" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/** One rival, every category, and who actually won each of the last 14 days. */
function HeadToHead({ rows, people, me }: { rows: LeaderboardRow[]; people: Person[]; me: string | null }) {
  const others = useMemo(() => people.filter((p) => p.id !== me).sort((a, b) => b.productive - a.productive), [people, me]);
  const [rivalId, setRivalId] = useState<string>("");
  const rival = others.find((p) => p.id === rivalId) ?? others[0];
  const mine = people.find((p) => p.id === me);

  const days = useMemo(() => lastNDates(rows, 14), [rows]);
  const strip = useMemo(() => {
    if (!mine || !rival) return [];
    const k = new Map(rows.map((r) => [`${r.memberId}|${r.date}`, r.productive]));
    return days.map((d) => {
      const a = k.get(`${mine.id}|${d}`) ?? 0;
      const b = k.get(`${rival.id}|${d}`) ?? 0;
      return { date: d, a, b, won: a > b, drew: a === b };
    });
  }, [rows, days, mine, rival]);

  if (!mine) return <p className="card p-4 text-sm text-faint">Log a day and you can compare yourself to anyone here.</p>;
  if (!rival) return <p className="card p-4 text-sm text-faint">Nobody else in this scope yet.</p>;

  const cmp = [
    { label: "Productive", a: mine.productive / mine.days, b: rival.productive / rival.days, better: "high" },
    { label: "Social", a: mine.social / mine.days, b: rival.social / rival.days, better: "high" },
    { label: "Brainrot", a: mine.brainrot / mine.days, b: rival.brainrot / rival.days, better: "low" },
    {
      label: "WorkMax",
      a: workMaxFrom(mine.productive / mine.days, mine.brainrot / mine.days) ?? 0,
      b: workMaxFrom(rival.productive / rival.days, rival.brainrot / rival.days) ?? 0,
      better: "high",
    },
  ];
  const wins = strip.filter((d) => d.won).length;
  const losses = strip.filter((d) => !d.won && !d.drew).length;

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">You vs</span>
        <select
          value={rival.id}
          onChange={(e) => setRivalId(e.target.value)}
          className="rounded-lg border bg-surface px-2 py-1 text-sm font-medium"
        >
          {others.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <span className="text-muted">
          — you won <b className="text-ok">{wins}</b> of the last {strip.length} days, lost <b className="text-danger">{losses}</b>.
        </span>
      </div>

      <div className="card mb-3 p-3">
        {cmp.map((c) => {
          const total = c.a + c.b || 1;
          const iWin = c.better === "high" ? c.a >= c.b : c.a <= c.b;
          return (
            <div key={c.label} className="mb-2 last:mb-0">
              <div className="mb-0.5 flex justify-between text-xs">
                <span className={`tabular-nums font-semibold ${iWin ? "text-accent" : "text-muted"}`}>{c.a.toFixed(1)}</span>
                <span className="text-faint">{c.label}{c.better === "low" && " (less is better)"}</span>
                <span className={`tabular-nums font-semibold ${!iWin ? "text-accent" : "text-muted"}`}>{c.b.toFixed(1)}</span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
                <div style={{ width: `${(c.a / total) * 100}%`, background: "var(--accent)" }} />
                <div style={{ width: `${(c.b / total) * 100}%`, background: teamMeta(rival.team).color }} />
              </div>
            </div>
          );
        })}
      </div>

      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Last {strip.length} days</p>
      <div className="flex gap-1">
        {strip.map((d) => (
          <div
            key={d.date}
            title={`${d.date}: you ${d.a.toFixed(1)}h vs ${rival.name} ${d.b.toFixed(1)}h`}
            className="h-8 flex-1 rounded"
            style={{ background: d.drew ? "var(--surface-2)" : d.won ? "var(--accent)" : teamMeta(rival.team).color }}
          />
        ))}
      </div>
    </>
  );
}
