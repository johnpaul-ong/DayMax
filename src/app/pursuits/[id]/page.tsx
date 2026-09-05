"use client";

/**
 * A pursuit's COMMUNITY home — shared, not personal. What it is
 * (owner-editable), who's leading, what's tracked, and a graph per stat.
 * Built-in pursuits (Life, Lifts) get community boards built from everyone's
 * totals, with a button through to your own logging page. Notes stay private
 * to their author.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
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
import {
  fetchLeaderboard,
  fetchLeaderboardLifts,
  listFriends,
  type Friendship,
  type LeaderboardLiftRow,
  type LeaderboardRow,
} from "@/lib/friends";
import {
  addPursuitMember,
  createStat,
  deletePursuit,
  deleteStat,
  fetchDirectory,
  fetchMyEntries,
  fetchStatData,
  fetchStats,
  leavePursuit,
  logEntry,
  pursuitLogHref,
  setPursuitPublic,
  setShowOnProfile,
  updatePursuitDescription,
  updateStat,
  type MyEntry,
  type Pursuit,
  type PursuitStat,
  type StatEntry,
} from "@/lib/pursuits";
import { weekStart } from "@/lib/ranking";
import { localToday } from "@/lib/dates";

const LINE_COLORS = ["#4f6ef7", "#16a34a", "#dc2626", "#f59e0b", "#0ea5e9", "#a78bfa", "#ec4899", "#14b8a6"];
const tickDate = (d: string) => (typeof d === "string" ? d.slice(5) : d);

export default function PursuitPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const todayISO = localToday();
  const ws = weekStart(todayISO);
  const [pursuit, setPursuit] = useState<Pursuit | null>(null);
  const [stats, setStats] = useState<PursuitStat[]>([]);
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [firstStatData, setFirstStatData] = useState<StatEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // description editing
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState("");

  // add-stat form
  const [sName, setSName] = useState("");
  const [sUnit, setSUnit] = useState("");
  const [sDir, setSDir] = useState<"more" | "less">("more");
  const [sCadence, setSCadence] = useState<"daily" | "whenever">("daily");
  const [sTarget, setSTarget] = useState("");

  function reload() {
    fetchDirectory()
      .then((ds) => {
        const p = ds.find((d) => d.id === id) ?? null;
        setPursuit(p);
        if (p) setDesc(p.description);
      })
      .catch((e) => setError(String(e.message ?? e)));
    fetchStats(id)
      .then((ss) => {
        setStats(ss);
        const first = ss.find((s) => !s.hidden && s.cadence === "daily") ?? ss.find((s) => !s.hidden);
        if (first) fetchStatData(first.id).then(setFirstStatData).catch(() => {});
      })
      .catch(() => {});
    listFriends().then((fs) => setFriends(fs.filter((f) => f.status === "accepted"))).catch(() => {});
  }
  useEffect(reload, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // top people: this-week totals on the pursuit's first visible stat
  const topPeople = useMemo(() => {
    const byMember = new Map<string, { name: string; week: number }>();
    for (const e of firstStatData) {
      if (e.date < ws || e.date > todayISO) continue;
      const cur = byMember.get(e.memberId) ?? { name: e.displayName, week: 0 };
      cur.week += e.value;
      byMember.set(e.memberId, cur);
    }
    return [...byMember.values()].sort((a, b) => b.week - a.week).slice(0, 3);
  }, [firstStatData, ws, todayISO]);

  // top people overall: all-time totals on the same stat, for the shared graph
  const topAllTime = useMemo(() => {
    const byMember = new Map<string, { name: string; total: number }>();
    for (const e of firstStatData) {
      const cur = byMember.get(e.memberId) ?? { name: e.displayName, total: 0 };
      cur.total += e.value;
      byMember.set(e.memberId, cur);
    }
    return [...byMember.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  }, [firstStatData]);

  if (error) return <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>;
  if (!pursuit) return <p className="text-sm text-muted">Loading pursuit…</p>;

  const visibleStats = stats.filter((s) => !s.hidden || pursuit.isOwner);
  const logHref = pursuitLogHref(pursuit);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{pursuit.name}</h1>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{pursuit.isPublic ? "public" : "invite-only"}</span>
          <span className="text-sm text-faint">{pursuit.memberCount} member{pursuit.memberCount === 1 ? "" : "s"} · by {pursuit.ownerName}{pursuit.isOwner && " (you)"}</span>
        </div>

        {editingDesc ? (
          <div className="mt-2">
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className="w-full rounded-lg border bg-surface px-2 py-1.5 text-sm" />
            <div className="mt-1 flex gap-2">
              <button
                onClick={() => void updatePursuitDescription(id, desc.trim()).then(() => { setEditingDesc(false); reload(); }).catch((e) => setMsg(String(e.message ?? e)))}
                className="btn-primary py-1"
              >
                Save
              </button>
              <button onClick={() => setEditingDesc(false)} className="btn-ghost py-1">Cancel</button>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted">
            {pursuit.description || "No description yet."}
            {pursuit.isOwner && (
              <button onClick={() => setEditingDesc(true)} className="ml-2 text-xs font-medium text-accent hover:underline">edit</button>
            )}
          </p>
        )}

        {topPeople.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Top this week</p>
            <div className="flex flex-wrap gap-2">
              {topPeople.map((t, i) => (
                <span key={t.name} className="rounded-full border bg-surface px-3 py-1 text-sm">
                  <span className="font-semibold text-faint">{i + 1}</span> {t.name} <span className="text-xs text-muted">{Math.round(t.week).toLocaleString()}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {stats.length > 0 && (
          <p className="mt-3 text-xs text-faint">
            Recording: {stats.filter((s) => !s.hidden).map((s) => s.name).join(" · ") || "nothing visible yet"}
          </p>
        )}

        {topAllTime.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Top people, all time</p>
            <div className="h-40">
              <ResponsiveContainer>
                <BarChart data={topAllTime.map((t) => ({ name: t.name, total: Math.round(t.total * 100) / 100 }))} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                  <Tooltip />
                  <Bar dataKey="total" fill="var(--accent)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {logHref && (
            <Link href={logHref} className="btn-primary py-1">
              Open your {pursuit.kind === "life" ? "day" : "lifts"} →
            </Link>
          )}
          {pursuit.isMember && !pursuit.isOwner && (
            <button onClick={() => void leavePursuit(id).then(() => (location.href = "/pursuits"))} className="btn-ghost py-1">Leave</button>
          )}
          {pursuit.isMember && (
            <>
              <button onClick={() => void setShowOnProfile(id, true).then(() => setMsg("Shown on your profile."))} className="btn-ghost py-1">Show on my profile</button>
              <button onClick={() => void setShowOnProfile(id, false).then(() => setMsg("Hidden from your profile."))} className="btn-ghost py-1">Hide from my profile</button>
            </>
          )}
          {pursuit.isOwner && (
            <>
              <button onClick={() => void setPursuitPublic(id, !pursuit.isPublic).then(reload).catch((e) => setMsg(String(e.message ?? e)))} className="btn-ghost py-1">
                Make {pursuit.isPublic ? "invite-only" : "public"}
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete "${pursuit.name}" and all its stats for everyone?`)) void deletePursuit(id).then(() => (location.href = "/pursuits"));
                }}
                className="rounded-xl border px-4 py-1 text-sm text-danger"
              >
                Delete
              </button>
            </>
          )}
        </div>
        {pursuit.isOwner && friends.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-muted">Add a friend:</span>
            {friends.map((f) => (
              <button key={f.memberId} onClick={() => void addPursuitMember(id, f.memberId).then(reload).catch((e) => setMsg(String(e.message ?? e)))} className="rounded-full border px-3 py-1 text-xs hover:bg-surface-2">
                + {f.displayName}
              </button>
            ))}
          </div>
        )}
        {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
      </div>

      {pursuit.kind === "life" && <LifeCommunity />}
      {pursuit.kind === "lifts" && <LiftsCommunity />}

      {visibleStats.map((s) => (
        <StatSection key={s.id} stat={s} isOwner={pursuit.isOwner} isMember={pursuit.isMember} onChanged={reload} />
      ))}
      {visibleStats.length === 0 && pursuit.kind === "custom" && (
        <p className="card p-4 text-sm text-faint">
          No stats yet. {pursuit.isOwner ? "Add the first one below — e.g. “Games played” (daily) or “Blitz rating” (whenever)." : "The owner hasn't added any yet."}
        </p>
      )}

      {pursuit.isOwner && (
        <div className="card p-4">
          <h2 className="mb-2 font-semibold">Add a stat</h2>
          <div className="flex flex-wrap items-end gap-2">
            <input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Name (e.g. Blitz rating)" className="w-44 rounded-lg border bg-surface px-2 py-2 text-sm" />
            <input value={sUnit} onChange={(e) => setSUnit(e.target.value)} placeholder="Unit (games, elo, words)" className="w-40 rounded-lg border bg-surface px-2 py-2 text-sm" />
            <select value={sCadence} onChange={(e) => setSCadence(e.target.value as any)} className="rounded-lg border bg-surface px-2 py-2 text-sm">
              <option value="daily">daily habit</option>
              <option value="whenever">log whenever (rating)</option>
            </select>
            <select value={sDir} onChange={(e) => setSDir(e.target.value as any)} className="rounded-lg border bg-surface px-2 py-2 text-sm">
              <option value="more">more is better</option>
              <option value="less">less is better</option>
            </select>
            <input value={sTarget} onChange={(e) => setSTarget(e.target.value)} type="number" step="any" placeholder="Daily target (optional)" className="w-40 rounded-lg border bg-surface px-2 py-2 text-sm" />
            <button
              onClick={() => {
                if (!sName.trim()) return;
                const t = sTarget.trim() === "" ? null : Number(sTarget);
                void createStat(id, { name: sName.trim(), unit: sUnit.trim(), direction: sDir, cadence: sCadence, target: Number.isFinite(t as number) ? t : null })
                  .then(() => { setSName(""); setSUnit(""); setSTarget(""); reload(); })
                  .catch((e) => setMsg(String(e.message ?? e)));
              }}
              disabled={!sName.trim()}
              className="btn-primary"
            >
              Add stat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The Life pursuit's community board: everyone's focus score and hours.
 * Built from leaderboard_day_totals — the same share-rule-enforcing function
 * the Arena uses, so nobody who set themselves to hidden ever shows up.
 */
function LifeCommunity() {
  const todayISO = localToday();
  const ws = weekStart(todayISO);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard()
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
      return {
        id: m.id,
        name: m.name,
        weekScore: score(week),
        weekP: week.reduce((s, r) => s + r.productive, 0),
        weekB: week.reduce((s, r) => s + r.brainrot, 0),
        allP: m.rows.reduce((s, r) => s + r.productive, 0),
        allScore: score(m.rows),
        days: new Set(m.rows.map((r) => r.date)).size,
      };
    });
  }, [rows, ws, todayISO]);

  const topWeek = useMemo(
    () => [...people].filter((p) => p.weekScore != null).sort((a, b) => (b.weekScore ?? 0) - (a.weekScore ?? 0)).slice(0, 5),
    [people]
  );
  const topAllTime = useMemo(() => [...people].sort((a, b) => b.allP - a.allP).slice(0, 5), [people]);

  // daily focus score for the top few, last six weeks
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
    const so = rows.reduce((s, r) => s + r.social, 0);
    const o = rows.reduce((s, r) => s + r.other, 0);
    return { p, b, so, o, days: new Set(rows.map((r) => r.date)).size };
  }, [rows]);

  if (loading) return <p className="text-sm text-muted">Loading the community…</p>;
  if (people.length === 0) return <p className="card p-4 text-sm text-faint">Nobody is sharing their day yet.</p>;

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-faint">People</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{people.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-faint">Days logged</p>
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
          subtitle="Focus score since Monday"
          rows={topWeek.map((p) => ({ id: p.id, name: p.name, value: `${p.weekScore}`, sub: `${p.weekP.toFixed(1)}h productive` }))}
        />
        <LeaderCard
          title="All-time greats"
          subtitle="Total productive hours"
          rows={topAllTime.map((p) => ({ id: p.id, name: p.name, value: `${p.allP.toFixed(0)}h`, sub: `score ${p.allScore ?? "—"}` }))}
        />
      </section>

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
                  <Line key={n} type="monotone" strokeWidth={2.5} dataKey={n} stroke={LINE_COLORS[i % LINE_COLORS.length]} dot={false} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-1 font-semibold">Hours this week</h2>
        <div className="h-64 card p-2">
          <ResponsiveContainer>
            <BarChart data={[...people].sort((a, b) => b.weekP - a.weekP).slice(0, 8).map((p) => ({ name: p.name, productive: Math.round(p.weekP * 10) / 10, brainrot: Math.round(p.weekB * 10) / 10 }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} unit="h" />
              <Tooltip />
              <Legend />
              <Bar dataKey="productive" fill="var(--accent)" />
              <Bar dataKey="brainrot" fill="#dc2626" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </>
  );
}

/** The Lifts pursuit's community board: who lifts what, and how it's moving. */
function LiftsCommunity() {
  const [rows, setRows] = useState<LeaderboardLiftRow[]>([]);
  const [exercise, setExercise] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboardLifts()
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
  }, []);

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
                  <Line key={n} type="monotone" strokeWidth={2.5} dataKey={n} stroke={LINE_COLORS[i % LINE_COLORS.length]} dot={{ r: 2 }} connectNulls />
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

function StatSection({ stat, isOwner, isMember, onChanged }: { stat: PursuitStat; isOwner: boolean; isMember: boolean; onChanged: () => void }) {
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

      {all.length > 0 && (
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
                    <Cell key={i} fill={LINE_COLORS[i % LINE_COLORS.length]} />
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
                <Bar dataKey="best" fill="#16a34a" />
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
                  <Line key={n} type="monotone" strokeWidth={2.5} dataKey={n} stroke={LINE_COLORS[i % LINE_COLORS.length]} dot={{ r: 2 }} connectNulls />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      {board.length > 0 && (
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
