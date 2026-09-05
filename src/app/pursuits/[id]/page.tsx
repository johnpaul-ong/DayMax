"use client";

/**
 * One pursuit: its stats (each with your chart, everyone's leaderboard,
 * daily-target streaks), logging with notes (notes stay private), members,
 * owner tools (add stats, add friends, public toggle, delete).
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { listFriends, type Friendship } from "@/lib/friends";
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
  setPursuitPublic,
  setShowOnProfile,
  type MyEntry,
  type Pursuit,
  type PursuitStat,
  type StatEntry,
} from "@/lib/pursuits";
import { weekStart } from "@/lib/ranking";

const LINE_COLORS = ["#4f6ef7", "#16a34a", "#dc2626", "#f59e0b", "#0ea5e9", "#a78bfa", "#ec4899", "#14b8a6"];
const tickDate = (d: string) => (typeof d === "string" ? d.slice(5) : d);

export default function PursuitPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [pursuit, setPursuit] = useState<Pursuit | null>(null);
  const [stats, setStats] = useState<PursuitStat[]>([]);
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // add-stat form
  const [sName, setSName] = useState("");
  const [sUnit, setSUnit] = useState("");
  const [sDir, setSDir] = useState<"more" | "less">("more");
  const [sCadence, setSCadence] = useState<"daily" | "whenever">("daily");
  const [sTarget, setSTarget] = useState("");

  function reload() {
    fetchDirectory()
      .then((ds) => setPursuit(ds.find((d) => d.id === id) ?? null))
      .catch((e) => setError(String(e.message ?? e)));
    fetchStats(id).then(setStats).catch(() => {});
    listFriends().then((fs) => setFriends(fs.filter((f) => f.status === "accepted"))).catch(() => {});
  }
  useEffect(reload, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>;
  if (!pursuit) return <p className="text-sm text-muted">Loading pursuit…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{pursuit.name}</h1>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{pursuit.isPublic ? "public" : "invite-only"}</span>
          <span className="text-sm text-faint">{pursuit.memberCount} member{pursuit.memberCount === 1 ? "" : "s"} · by {pursuit.ownerName}{pursuit.isOwner && " (you)"}</span>
        </div>
        <p className="mt-1 text-sm text-muted">{pursuit.description}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
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
              <button
                onClick={() => void setPursuitPublic(id, !pursuit.isPublic).then(reload).catch((e) => setMsg(String(e.message ?? e)))}
                className="btn-ghost py-1"
              >
                Make {pursuit.isPublic ? "invite-only" : "public"}
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete "${pursuit.name}" and all its stats for everyone?`))
                    void deletePursuit(id).then(() => (location.href = "/pursuits"));
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

      {stats.map((s) => (
        <StatSection key={s.id} stat={s} isOwner={pursuit.isOwner} isMember={pursuit.isMember} onDeleted={reload} />
      ))}
      {stats.length === 0 && (
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
                  .then(() => {
                    setSName(""); setSUnit(""); setSTarget("");
                    reload();
                  })
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

function StatSection({ stat, isOwner, isMember, onDeleted }: { stat: PursuitStat; isOwner: boolean; isMember: boolean; onDeleted: () => void }) {
  const todayISO = new Date().toISOString().slice(0, 10);
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

  const chart = useMemo(() => {
    const byDate = new Map<string, Record<string, string | number | null>>();
    const names = new Set<string>();
    for (const e of all) {
      names.add(e.displayName);
      if (!byDate.has(e.date)) byDate.set(e.date, { date: e.date });
      byDate.get(e.date)![e.displayName] = e.value;
    }
    return { data: [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1)), names: [...names].sort() };
  }, [all]);

  const board = useMemo(() => {
    const byMember = new Map<string, { name: string; rows: StatEntry[] }>();
    for (const e of all) {
      if (!byMember.has(e.memberId)) byMember.set(e.memberId, { name: e.displayName, rows: [] });
      byMember.get(e.memberId)!.rows.push(e);
    }
    const better = (a: number, b: number) => (stat.direction === "more" ? b - a : a - b);
    return [...byMember.values()]
      .map((m) => {
        const vals = m.rows.map((r) => r.value);
        const week = m.rows.filter((r) => r.date >= ws && r.date <= todayISO).reduce((s, r) => s + r.value, 0);
        return {
          name: m.name,
          today: m.rows.find((r) => r.date === todayISO)?.value ?? null,
          week,
          total: vals.reduce((s, v) => s + v, 0),
          best: stat.direction === "more" ? Math.max(...vals) : Math.min(...vals),
          latest: m.rows.sort((a, b) => (a.date < b.date ? -1 : 1))[m.rows.length - 1]?.value ?? null,
        };
      })
      .sort((a, b) => (stat.cadence === "daily" ? b.week - a.week : better(a.latest ?? -Infinity, b.latest ?? -Infinity)));
  }, [all, stat, todayISO, ws]);

  const notes = mine.filter((m) => m.note).slice(0, 8);

  return (
    <section className="card p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="font-semibold">{stat.name}</h2>
        <span className="text-xs text-faint">
          {stat.unit && `${stat.unit} · `}{stat.cadence === "daily" ? "daily" : "log whenever"} · {stat.direction === "more" ? "more is better" : "less is better"}
          {stat.target != null && ` · target ${stat.target}`}
        </span>
        {isOwner && (
          <button onClick={() => void deleteStat(stat.id).then(onDeleted)} className="ml-auto text-xs text-danger hover:opacity-70">
            remove stat
          </button>
        )}
      </div>

      {isMember && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border bg-surface px-2 py-2 text-sm" />
          <input type="number" step="any" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={stat.unit || "value"} className="w-28 rounded-lg border bg-surface px-2 py-2 text-sm" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (private) — e.g. what the words were about" className="min-w-56 flex-1 rounded-lg border bg-surface px-2 py-2 text-sm" />
          <button
            onClick={() => {
              const v = Number(value);
              if (!Number.isFinite(v)) return;
              void logEntry(stat.id, date, v, note.trim() || null)
                .then(() => {
                  setValue(""); setNote("");
                  setSaved(true);
                  setTimeout(() => setSaved(false), 2000);
                  reload();
                })
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

      {chart.data.length > 0 && (
        <div className="mb-3 h-52">
          <ResponsiveContainer>
            <LineChart data={chart.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
              <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
              <Tooltip labelFormatter={(d) => String(d)} />
              {chart.names.length > 1 && <Legend />}
              {stat.target != null && <ReferenceLine y={stat.target} strokeDasharray="6 3" stroke="var(--accent)" label={{ value: `target ${stat.target}`, fontSize: 10 }} />}
              {chart.names.map((n, i) => (
                <Line key={n} type="monotone" strokeWidth={2.5} dataKey={n} stroke={LINE_COLORS[i % LINE_COLORS.length]} dot={{ r: 2 }} connectNulls />
              ))}
            </LineChart>
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
