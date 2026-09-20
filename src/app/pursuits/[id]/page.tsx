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
  fetchPursuitDayTotals,
  fetchPursuitLifts,
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
  fetchPursuitActivity,
  fetchPursuitMembers,
  fetchStatData,
  fetchStatSpread,
  fetchStatSummary,
  fetchStatTop,
  fetchMyMembership,
  fetchStats,
  joinPursuit,
  leavePursuit,
  logEntry,
  pursuitLogHref,
  setPursuitPublic,
  setShowOnProfile,
  updatePursuitDescription,
  updateStat,
  type ActivityWeek,
  type MyEntry,
  type Pursuit,
  type PursuitMember,
  type PursuitStat,
  type SpreadBucket,
  type StatEntry,
  type StatSummary,
  type StatTop,
} from "@/lib/pursuits";
import { weekStart, workMaxFrom } from "@/lib/ranking";
import { localToday } from "@/lib/dates";
import { fetchPursuitTeams, teamMeta, type Team, type TeamStanding } from "@/lib/teams";
import { loadTheme } from "@/lib/theme";
import { CHART_DANGER, CHART_OK, chartSeries } from "@/lib/chartColors";
import DayClock, { type ClockSlot } from "../../day-clock";
import IncomeRing, { type RingSlice } from "../../money/income-ring";
import BigThree from "../../big-three";
import type { DayStripRow } from "@/lib/friends";

const MONEY_PURSUIT_ID = "33333333-3333-4333-8333-333333333305";


const tickDate = (d: string) => (typeof d === "string" ? d.slice(5) : d);


/**
 * "3d ago", "today", "never" — the point is to see who's ACTIVE without
 * doing calendar arithmetic in your head.
 */
function lastLoggedLabel(iso: string | null, today: string): { text: string; tone: "hot" | "warm" | "cold" | "none" } {
  if (!iso) return { text: "never", tone: "none" };
  const d = (a: string) => new Date(a + "T00:00:00").getTime();
  const days = Math.max(0, Math.round((d(today) - d(iso)) / 86400000));
  if (days === 0) return { text: "today", tone: "hot" };
  if (days === 1) return { text: "yesterday", tone: "hot" };
  if (days < 7) return { text: `${days}d ago`, tone: "warm" };
  if (days < 30) return { text: `${Math.round(days / 7)}w ago`, tone: "cold" };
  return { text: `${Math.round(days / 30)}mo ago`, tone: "cold" };
}
export default function PursuitPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const todayISO = localToday();
  const ws = weekStart(todayISO);
  const [pursuit, setPursuit] = useState<Pursuit | null>(null);
  const [stats, setStats] = useState<PursuitStat[]>([]);
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [members, setMembers] = useState<PursuitMember[]>([]);
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
  // Community = everyone's view. Mine = your own data and the place to log it.
  // Same page, two lenses, rather than two destinations to hunt for.
  const [view, setView] = useState<"community" | "mine">("community");
  const [showOnProfile, setShowOnProfileState] = useState(false);

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
    fetchPursuitMembers(id).then(setMembers).catch(() => setMembers([]));
    fetchMyMembership(id).then((m) => setShowOnProfileState(!!m?.showOnProfile)).catch(() => {});
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
              {pursuit.kind === "life"
                ? "Log your day →"
                : pursuit.kind === "lifts"
                ? "Log a lift →"
                : "Log your spending →"}
            </Link>
          )}
          {pursuit.isMember && !pursuit.isOwner && (
            <button onClick={() => void leavePursuit(id).then(() => (location.href = "/pursuits"))} className="btn-ghost py-1">Leave</button>
          )}
          {pursuit.isMember && (
            <>
              <button
                onClick={() => {
                  const next = !showOnProfile;
                  setShowOnProfile(id, next)
                    .then(() => {
                      setShowOnProfileState(next);
                      setMsg(next ? "Now shown on your profile." : "Hidden from your profile.");
                      setTimeout(() => setMsg(null), 2500);
                    })
                    .catch((e) => setMsg(String(e.message ?? e)));
                }}
                className={`py-1 ${showOnProfile ? "btn-primary" : "btn-ghost"}`}
              >
                {showOnProfile ? "✓ On my profile" : "Show on my profile"}
              </button>
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

      {/*
        The everyone-pursuit has no roster (it would be a directory of every
        account). Other Life-kind pursuits — like the Avengers one — do, and
        the server returns an empty list for the one that shouldn't.
      */}
      {pursuit.isMember && (
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
          {(["community", "mine"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex-1 rounded-lg px-3 py-2.5 ${view === v ? "bg-surface font-semibold" : "text-muted"}`}
            >
              {v === "community" ? "Community" : "Mine"}
            </button>
          ))}
        </div>
      )}

      {view === "mine" ? (
        <MineView pursuit={pursuit} stats={visibleStats} logHref={logHref} onChanged={reload} />
      ) : (
        <>
      {/* ONE signature graph at the very top of every pursuit's community
          view. Same slot, per-kind visual. See SignatureVisual comment. */}
      <SignatureVisualForPursuit pursuit={pursuit} />

      <PursuitPreview pursuit={pursuit} onJoined={reload} />

      <TeamStandings pursuitId={id} />

      <MembersSection members={members} total={pursuit.memberCount} />

      {pursuit.kind === "life" && <LifeCommunity pursuitId={id} memberCount={pursuit.memberCount} />}
      {pursuit.kind === "lifts" && <LiftsCommunity pursuitId={id} />}

      {visibleStats.map((s) => (
        <StatSection key={s.id} stat={s} isOwner={pursuit.isOwner} isMember={pursuit.isMember} onChanged={reload} />
      ))}
      {visibleStats.length === 0 && pursuit.kind === "custom" && (
        <p className="card p-4 text-sm text-faint">
          No stats yet. {pursuit.isOwner ? "Add the first one below — e.g. “Games played” (daily) or “Blitz rating” (whenever)." : "The owner hasn't added any yet."}
        </p>
      )}
        </>
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
 * Your own side of a pursuit: where you log, and what you alone have done.
 *
 * Built-ins hand off to their dedicated pages (they have bespoke editors);
 * custom pursuits get their stat sections, which already include the logging
 * form and your private notes.
 */
function MineView({
  pursuit,
  stats,
  logHref,
  onChanged,
}: {
  pursuit: Pursuit;
  stats: PursuitStat[];
  logHref: string | null;
  onChanged: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Real numbers first. A bare "go and log" link was a dead end. */}
      {pursuit.kind === "life" && <MyLife />}
      {pursuit.kind === "lifts" && <MyLifts />}
      {logHref === "/money" && <MyMoney />}

      {logHref && (
        <Link href={logHref} className="btn-primary inline-block">
          {pursuit.kind === "life" ? "Log your day →" : pursuit.kind === "lifts" ? "Log a lift →" : "Log spending →"}
        </Link>
      )}

      {stats.map((s) => (
        <MyStat key={s.id} stat={s} isOwner={pursuit.isOwner} isMember={pursuit.isMember} onChanged={onChanged} />
      ))}

      {stats.length === 0 && !logHref && (
        <p className="card p-4 text-sm text-faint">
          Nothing to log here yet — this pursuit has no stats.
          {pursuit.isOwner && " Add one from the Community tab."}
        </p>
      )}
    </div>
  );
}

/** Your last 30 days of Life, as numbers rather than a promise of numbers. */
function MyLife() {
  const [rows, setRows] = useState<Array<{ date: string; productive: number; brainrot: number }>>([]);
  useEffect(() => {
    (async () => {
      const { fetchDayEntries } = await import("@/lib/data");
      const { defaultBuckets, HOURS_PER_SLOT } = await import("@/lib/categories");
      const from = new Date();
      from.setDate(from.getDate() - 29);
      const es = await fetchDayEntries(localToday(from), localToday()).catch(() => []);
      const b = defaultBuckets();
      const byDate = new Map<string, { productive: number; brainrot: number }>();
      for (const e of es) {
        const cur = byDate.get(e.date) ?? { productive: 0, brainrot: 0 };
        const bucket = b[e.category];
        if (bucket === "productive") cur.productive += HOURS_PER_SLOT;
        else if (bucket === "brainrot") cur.brainrot += HOURS_PER_SLOT;
        byDate.set(e.date, cur);
      }
      setRows([...byDate.entries()].sort().map(([date, v]) => ({ date, ...v })));
    })();
  }, []);
  if (rows.length === 0) return <p className="card p-4 text-sm text-faint">Nothing logged in the last 30 days.</p>;

  const p = rows.reduce((s, r) => s + r.productive, 0);
  const br = rows.reduce((s, r) => s + r.brainrot, 0);
  const wm = workMaxFrom(p, br);
  return (
    <section>
      <h2 className="mb-2 font-semibold">Your last 30 days</h2>
      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <Metric label="Productive" value={`${p.toFixed(0)}h`} />
        <Metric label="Brainrot" value={`${br.toFixed(0)}h`} />
        <Metric label="WorkMax" value={`${wm ?? "—"}`} />
        <Metric label="Days logged" value={String(rows.length)} />
      </div>
      <div className="h-56 card p-2">
        <ResponsiveContainer>
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
            <YAxis tick={{ fontSize: 10 }} unit="h" />
            <Tooltip />
            <Legend />
            <Bar dataKey="productive" stackId="a" fill={CHART_OK} />
            <Bar dataKey="brainrot" stackId="a" fill={CHART_DANGER} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/** Your own lifting history, per exercise. */
function MyLifts() {
  const [rows, setRows] = useState<Array<{ date: string; exercise: string; weightKg: number | null }>>([]);
  const [ex, setEx] = useState("");
  useEffect(() => {
    import("@/lib/data").then(({ fetchLifts }) =>
      fetchLifts()
        .then((ls) => {
          setRows(ls);
          if (ls.length) {
            const counts = new Map<string, number>();
            for (const l of ls) counts.set(l.exercise, (counts.get(l.exercise) ?? 0) + 1);
            setEx([...counts.entries()].sort(([, a], [, b]) => b - a)[0][0]);
          }
        })
        .catch(() => {})
    );
  }, []);
  const exercises = useMemo(() => [...new Set(rows.map((r) => r.exercise))].sort(), [rows]);
  const series = useMemo(
    () =>
      rows
        .filter((r) => r.exercise === ex && r.weightKg != null)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((r) => ({ date: r.date, weight: r.weightKg })),
    [rows, ex]
  );
  if (rows.length === 0) return <p className="card p-4 text-sm text-faint">No lifts logged yet.</p>;

  const best = Math.max(...series.map((s) => Number(s.weight ?? 0)), 0);
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Your lifts</h2>
        <select value={ex} onChange={(e) => setEx(e.target.value)} className="rounded-lg border bg-surface px-2 py-1 text-sm">
          {exercises.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Metric label="Sessions" value={String(series.length)} />
        <Metric label="Best" value={`${best}kg`} />
        <Metric label="Exercises" value={String(exercises.length)} />
      </div>
      {series.length > 1 && (
        <div className="h-56 card p-2">
          <ResponsiveContainer>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} unit="kg" />
              <Tooltip />
              <Line type="monotone" dataKey="weight" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

/**
 * Your spending this month, without leaving the pursuit.
 *
 * Three things, in order:
 *   1. The IncomeRing -- SAME shape everyone else sees on Community, so
 *      this tab isn't visually alien from the one next to it.
 *   2. The list of actual purchases grouped by category, with amounts and
 *      item descriptions. This replaces the two-colour "essential vs
 *      non-essential" stacked bar chart, which was a lot of pixels for
 *      one very small piece of information (you already know if it was
 *      essential -- YOU categorised it).
 *   3. A single "% of income non-essential" chip. That is the number
 *      Budget Baddies actually ranks on, so it belongs somewhere.
 */
function MyMoney() {
  const [sum, setSum] = useState<{ total: number; essential: number; nonEssential: number; income: number; nonEssentialPct: number | null } | null>(null);
  const [byCat, setByCat] = useState<Array<{ categoryId: string | null; name: string; essential: boolean; total: number }>>([]);
  const [entries, setEntries] = useState<Array<{ id: string; date: string; amount: number; categoryId: string | null; item: string | null }>>([]);
  const [cats, setCats] = useState<Array<{ id: string; name: string; essential: boolean }>>([]);
  // Window we're actually summarising. "Since last paycheck" is the
  // pay-period a person lives in; a calendar month is an accountant's
  // window. If nothing has ever been logged as income, fall back to
  // this month so the page isn't empty.
  const [rangeFrom, setRangeFrom] = useState<string | null>(null);
  const [rangeLabel, setRangeLabel] = useState<string>("");
  useEffect(() => {
    (async () => {
      const m = await import("@/lib/money");
      const today = localToday();
      const last = await m.lastPaycheckDate().catch(() => null);
      const from = last ?? `${today.slice(0, 7)}-01`;
      const to = today;
      setRangeFrom(from);
      setRangeLabel(last ? `since your last paycheck (${last})` : "this month (no income logged yet)");
      m.fetchSummary(from, to).then(setSum).catch(() => {});
      m.fetchByCategory(from, to).then(setByCat).catch(() => {});
      m.fetchSpend(from, to).then((rs) => setEntries(rs.map((r) => ({ id: r.id, date: r.date, amount: r.amount, categoryId: r.categoryId, item: r.item ?? null })))).catch(() => {});
      m.fetchCategories().then((cs) => setCats(cs.map((c) => ({ id: c.id, name: c.name, essential: c.essential })))).catch(() => {});
    })();
  }, []);
  if (!sum) return null;

  // Group real entries under their category, so a Coffee $4 twice reads as
  // "Coffee $8 (2 items: Latte, Flat white)" -- hoverable detail rather than
  // a nameless red bar.
  const catById = new Map(cats.map((c) => [c.id, c]));
  type Entry = { id: string; date: string; amount: number; item: string | null };
  const grouped = new Map<string, { name: string; essential: boolean; total: number; items: Entry[] }>();
  for (const e of entries) {
    const cat = e.categoryId ? catById.get(e.categoryId) : null;
    const key = e.categoryId ?? "__uncat";
    const name = cat?.name ?? "Uncategorised";
    const essential = cat?.essential ?? false;
    if (!grouped.has(key)) grouped.set(key, { name, essential, total: 0, items: [] });
    const g = grouped.get(key)!;
    g.total += e.amount;
    g.items.push({ id: e.id, date: e.date, amount: e.amount, item: e.item });
  }
  const rows = [...grouped.values()].sort((a, b) => b.total - a.total);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2">
        <h2 className="font-semibold">Your pay period</h2>
        <span className="text-xs text-faint">{rangeLabel}</span>
      </div>

      {/* The one canonical Money visual. Same shape you show to everyone
          else -- Mine tab and Community tab now speak one language. */}
      <div className="card mb-4 p-4">
        <IncomeRing
          slices={byCat.map((c) => ({
            categoryId: c.categoryId,
            name: c.name,
            essential: c.essential,
            amount: c.total,
          }))}
          income={sum.income || null}
          size={280}
        />
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <Metric label="Spent" value={`$${sum.total.toFixed(0)}`} />
        <Metric label="Essential" value={`$${sum.essential.toFixed(0)}`} />
        <Metric label="Non-essential" value={`$${sum.nonEssential.toFixed(0)}`} />
        <Metric label="% of income" value={sum.nonEssentialPct != null ? `${sum.nonEssentialPct}%` : "—"} />
      </div>

      {/* Where the money actually went. Categories expand on click to reveal
          the item-by-item detail -- that answers "what did I spend on?"
          which the stacked bar chart could never answer. */}
      {rows.length > 0 && (
        <div className="card p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">What you actually spent on</p>
          <div className="divide-y">
            {rows.map((r) => (
              <CategoryRow key={r.name} row={r} totalMonth={sum.total} />
            ))}
          </div>
        </div>
      )}
      {rows.length === 0 && (
        <p className="card p-4 text-sm text-faint">Nothing logged this month yet.</p>
      )}
    </section>
  );
}

/** One row of the "what you actually spent on" list. Expandable to see the
 *  individual purchases -- that IS the missing detail. */
function CategoryRow({
  row,
  totalMonth,
}: {
  row: { name: string; essential: boolean; total: number; items: Array<{ id: string; date: string; amount: number; item: string | null }> };
  totalMonth: number;
}) {
  const [open, setOpen] = useState(false);
  const pct = totalMonth > 0 ? (row.total / totalMonth) * 100 : 0;
  const tint = row.essential ? "var(--ok)" : "var(--danger)";
  const items = [...row.items].sort((a, b) => b.amount - a.amount);
  return (
    <div className="py-2.5">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left">
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tint }} />
        <span className="min-w-0 flex-1 text-sm font-medium">{row.name}</span>
        <span className="shrink-0 text-xs text-faint">{Math.round(pct)}%</span>
        <span className="shrink-0 tabular-nums text-sm font-semibold">${row.total.toFixed(0)}</span>
        <span className="shrink-0 text-xs text-faint">{open ? "▾" : "▸"}</span>
      </button>
      {/* thin bar under the row -- one bar per category, coloured by
          essential/non-essential, so the LIST reads as a chart too */}
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full" style={{ width: `${pct}%`, background: tint }} />
      </div>
      {open && (
        <div className="mt-2 space-y-1 pl-4">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 text-xs">
              <span className="text-faint tabular-nums">{it.date.slice(5)}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{it.item || row.name}</span>
              <span className="shrink-0 tabular-nums font-medium">${it.amount.toFixed(2)}</span>
            </div>
          ))}
          {items.length === 0 && <p className="text-xs text-faint">No items in this category.</p>}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-faint">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

/** A custom stat, from YOUR side: your own series, your totals, and the form. */
function MyStat({
  stat,
  isOwner,
  isMember,
  onChanged,
}: {
  stat: PursuitStat;
  isOwner: boolean;
  isMember: boolean;
  onChanged: () => void;
}) {
  const [mine, setMine] = useState<MyEntry[]>([]);
  useEffect(() => {
    fetchMyEntries(stat.id).then(setMine).catch(() => {});
  }, [stat.id]);

  const series = useMemo(
    () => [...mine].sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => ({ date: e.date, value: e.value })),
    [mine]
  );
  const total = mine.reduce((s, e) => s + e.value, 0);
  const best = mine.length ? (stat.direction === "less" ? Math.min(...mine.map((m) => m.value)) : Math.max(...mine.map((m) => m.value))) : null;

  return (
    <section>
      <h2 className="mb-2 font-semibold">{stat.name} — yours</h2>
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Metric label="Entries" value={String(mine.length)} />
        <Metric label={stat.cadence === "daily" ? "Total" : "Latest"} value={
          stat.cadence === "daily" ? Math.round(total).toLocaleString() : String(series[series.length - 1]?.value ?? "—")
        } />
        <Metric label={stat.direction === "less" ? "Lowest" : "Best"} value={best == null ? "—" : String(best)} />
      </div>
      {series.length > 1 && (
        <div className="mb-3 h-52 card p-2">
          <ResponsiveContainer>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} />
              <Tooltip />
              {stat.target != null && <ReferenceLine y={stat.target} strokeDasharray="6 3" stroke="var(--accent)" />}
              <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <StatSection stat={stat} isOwner={isOwner} isMember={isMember} onChanged={onChanged} mineOnly />
    </section>
  );
}

/**
 * What a pursuit looks like BEFORE you join.
 *
 * Everything below is an aggregate — counts, averages, spread, top few — so it
 * can be shown to strangers without leaking anyone's individual entries. This
 * exists because the page used to be blank for non-members: the leaderboard
 * and charts were behind membership, so there was nothing to be curious about
 * and no reason to join.
 */

/**
 * The one signature graph per pursuit. Every pursuit landing page opens with
 * ITS OWN visual identity, not a wall of text before the good stuff:
 *
 *   life    -> aggregate day-clock (spiral): most common activity by hour
 *   lifts   -> big-three donut (squat / dead / bench), read at a glance
 *   money   -> income ring, split essential / non-essential / unspent
 *   custom  -> a stat-summary bar for the first visible stat; the community
 *              charts below still work, this just gives every pursuit a hero
 *
 * Callers pass the same `pursuit` object plus optional per-kind data. Missing
 * data resolves to a friendly "log something and this fills" rather than an
 * empty axis grid.
 */
function SignatureVisualForPursuit({ pursuit }: { pursuit: Pursuit }) {
  const [lifeStrip, setLifeStrip] = useState<DayStripRow[] | undefined>();
  const [lifts, setLifts] = useState<Array<{ date: string; exercise: string; weightKg: number | null }> | undefined>();
  const [moneySlices, setMoneySlices] = useState<RingSlice[] | undefined>();
  const [moneyIncome, setMoneyIncome] = useState<number | null | undefined>();

  useEffect(() => {
    let alive = true;
    (async () => {
      if (pursuit.kind === "life") {
        // aggregate across every member's shared day strip -- one query per
        // pursuit, capped by the RPC
        try {
          const { fetchAllDayEntries } = await import("@/lib/data");
          const es = await fetchAllDayEntries();
          if (alive) setLifeStrip(es.map((e) => ({ date: e.date, slot: e.slot, category: e.category, label: e.label ?? null })));
        } catch {
          if (alive) setLifeStrip([]);
        }
      } else if (pursuit.kind === "lifts") {
        try {
          const { fetchLifts } = await import("@/lib/data");
          const rows = await fetchLifts();
          if (alive) setLifts(rows.map((l) => ({ date: l.date, exercise: l.exercise, weightKg: l.weightKg })));
        } catch {
          if (alive) setLifts([]);
        }
      } else if (pursuit.id === MONEY_PURSUIT_ID) {
        try {
          const { fetchByCategory, fetchSummary } = await import("@/lib/money");
          const today = localToday();
          const from = today.slice(0, 7) + "-01";
          const [y, m2] = today.split("-").map(Number);
          const to = `${today.slice(0, 7)}-${String(new Date(y, m2, 0).getDate()).padStart(2, "0")}`;
          const [cats, sum] = await Promise.all([fetchByCategory(from, to), fetchSummary(from, to).catch(() => null)]);
          if (!alive) return;
          setMoneySlices(cats.map((c) => ({ categoryId: c.categoryId, name: c.name, essential: c.essential, amount: c.total })));
          setMoneyIncome(sum?.income ?? null);
        } catch {
          if (alive) { setMoneySlices([]); setMoneyIncome(null); }
        }
      }
    })();
    return () => { alive = false; };
  }, [pursuit.id, pursuit.kind]);

  return <SignatureVisual pursuit={pursuit} lifeStrip={lifeStrip} lifts={lifts} moneySlices={moneySlices} moneyIncome={moneyIncome} />;
}

function SignatureVisual({
  pursuit,
  lifeStrip,
  lifts,
  moneySlices,
  moneyIncome,
}: {
  pursuit: Pursuit;
  lifeStrip?: DayStripRow[];
  lifts?: Array<{ date: string; exercise: string; weightKg: number | null }>;
  moneySlices?: RingSlice[];
  moneyIncome?: number | null;
}) {
  // Life: typical day as a spiral clock, most common category per quarter hour.
  if (pursuit.kind === "life" && lifeStrip && lifeStrip.length > 0) {
    const perSlot = new Map<number, Map<number, number>>();
    for (const r of lifeStrip) {
      if (!perSlot.has(r.slot)) perSlot.set(r.slot, new Map());
      const m = perSlot.get(r.slot)!;
      m.set(r.category, (m.get(r.category) ?? 0) + 1);
    }
    const clockSlots = new Map<number, ClockSlot>();
    for (const [slot, counts] of perSlot) {
      const [cat] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      clockSlots.set(slot, { category: cat });
    }
    return (
      <section className="card p-4">
        <h2 className="mb-1 font-semibold">A typical day here</h2>
        <p className="mb-3 text-sm text-muted">
          Every logged day in this pursuit collapsed onto one dial — the most common thing at each quarter hour.
        </p>
        <DayClock slots={clockSlots} />
      </section>
    );
  }

  if (pursuit.kind === "lifts" && lifts && lifts.length > 0) {
    return (
      <section className="card p-4">
        <BigThree rows={lifts} title="The big three, this pursuit" />
      </section>
    );
  }

  if (pursuit.id === MONEY_PURSUIT_ID && moneySlices) {
    return (
      <section className="card p-4">
        <h2 className="mb-1 font-semibold">This month, on your income</h2>
        <p className="mb-3 text-sm text-muted">
          Everything you make, split three ways. Same shape every person gets — panel of these on Budget Baddies.
        </p>
        <IncomeRing slices={moneySlices} income={moneyIncome ?? null} size={300} />
      </section>
    );
  }

  // Fallback for custom pursuits without a hero: a quiet placeholder rather
  // than nothing. The rest of the page still renders as before.
  return null;
}

function PursuitPreview({ pursuit, onJoined }: { pursuit: Pursuit; onJoined: () => void }) {
  const [stats, setStats] = useState<StatSummary[]>([]);
  const [activity, setActivity] = useState<ActivityWeek[]>([]);
  const [joining, setJoining] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchStatSummary(pursuit.id).then(setStats).catch(() => {});
    fetchPursuitActivity(pursuit.id).then(setActivity).catch(() => {});
  }, [pursuit.id]);

  const live = useMemo(() => {
    const recent = activity.slice(-4);
    return {
      entries: recent.reduce((s, w) => s + w.entries, 0),
      people: Math.max(0, ...recent.map((w) => w.activeMembers)),
    };
  }, [activity]);

  if (stats.length === 0 && activity.length === 0) return null;
  const totalEntries = stats.reduce((s, x) => s + x.entries, 0);

  return (
    <section className="space-y-4">
      {!pursuit.isMember && (
        <div className="card border-2 border-accent-soft p-5">
          <h2 className="text-lg font-semibold">Join {pursuit.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {stats.length > 0 ? (
              <>
                You&apos;d be tracking <b>{stats.map((s) => s.name).join(", ")}</b> alongside{" "}
                {pursuit.memberCount} {pursuit.memberCount === 1 ? "person" : "people"} who&apos;ve logged{" "}
                {totalEntries.toLocaleString()} entries between them.
              </>
            ) : (
              <>Nobody has logged anything yet — join and you&apos;re the first on the board.</>
            )}
          </p>
          <button
            onClick={() => {
              setJoining(true);
              joinPursuit(pursuit.id)
                .then(onJoined)
                .catch((e) => setErr(String(e.message ?? e)))
                .finally(() => setJoining(false));
            }}
            disabled={joining}
            className="btn-primary mt-3"
          >
            {joining ? "Joining…" : `Join ${pursuit.name}`}
          </button>
          {err && <p className="mt-2 text-sm text-danger">{err}</p>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-faint">Members</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{pursuit.memberCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-faint">Entries logged</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{totalEntries.toLocaleString()}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-faint">Active (4wk)</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{live.people}</p>
          <p className="mt-0.5 text-xs text-muted">{live.entries.toLocaleString()} entries</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-faint">Tracking</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{stats.length}</p>
          <p className="mt-0.5 truncate text-xs text-muted">{stats.map((s) => s.name).join(" · ") || "nothing yet"}</p>
        </div>
      </div>

      {activity.length > 1 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Activity</h3>
          <div className="h-40 card p-2">
            <ResponsiveContainer>
              <BarChart data={activity}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="weekStart" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip labelFormatter={(d) => `Week of ${d}`} />
                <Legend />
                <Bar dataKey="entries" name="entries" fill="var(--accent)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="activeMembers" name="people" fill={CHART_OK} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {stats.map((s) => (
        <StatPreview key={s.statId} stat={s} />
      ))}
    </section>
  );
}

/** Headline numbers, the spread of everyone's averages, and the top five. */
function StatPreview({ stat }: { stat: StatSummary }) {
  const [spread, setSpread] = useState<SpreadBucket[]>([]);
  const [top, setTop] = useState<StatTop[]>([]);

  useEffect(() => {
    fetchStatSpread(stat.statId).then(setSpread).catch(() => {});
    fetchStatTop(stat.statId).then(setTop).catch(() => {});
  }, [stat.statId]);

  if (stat.entries === 0) return null;

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h3 className="font-semibold">{stat.name}</h3>
        <span className="text-xs text-faint">
          {stat.participants} {stat.participants === 1 ? "person" : "people"} · {stat.entries.toLocaleString()} entries
          {stat.lastLogged && ` · last logged ${stat.lastLogged}`}
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-6">
        <div>
          <p className="text-2xl font-bold tabular-nums">{stat.avgValue ?? "—"}</p>
          <p className="text-xs text-muted">average {stat.unit}</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{stat.bestValue ?? "—"}</p>
          <p className="text-xs text-muted">{stat.direction === "less" ? "lowest" : "best"} {stat.unit}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {spread.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Where people land</p>
            <div className="h-32">
              <ResponsiveContainer>
                <BarChart data={spread.map((b) => ({ range: `${b.low}–${b.high}`, members: b.members }))}>
                  <XAxis dataKey="range" tick={{ fontSize: 8 }} interval={0} angle={-25} textAnchor="end" height={38} />
                  <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                  <Tooltip formatter={(v: number) => [`${v} member${v === 1 ? "" : "s"}`, "in range"]} />
                  <Bar dataKey="members" fill="var(--accent)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-faint">Each member&apos;s average, bucketed — see whether you&apos;d fit in.</p>
          </div>
        )}

        {top.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Leading</p>
            <ol className="space-y-1">
              {top.map((t, i) => (
                <li key={t.memberId} className="flex items-center gap-2 text-sm">
                  <span className="w-4 text-center font-semibold text-faint">{i + 1}</span>
                  <Link href={`/friends/${t.memberId}`} className="truncate font-medium hover:text-accent hover:underline">
                    {t.displayName}
                  </Link>
                  <span className="ml-auto shrink-0 tabular-nums">
                    {t.score}
                    <span className="ml-1 text-xs text-faint">{stat.unit}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Light vs Midnight vs Cottage, for this pursuit. Ranked on a PER-MEMBER average
 * so the biggest team doesn't win automatically — a team of three can beat a
 * team of thirty by being better, which is the only way this stays interesting.
 */
function TeamStandings({ pursuitId }: { pursuitId: string }) {
  const [rows, setRows] = useState<TeamStanding[]>([]);
  const [mine, setMine] = useState<Team | null>(null);

  useEffect(() => {
    fetchPursuitTeams(pursuitId).then(setRows).catch(() => {});
    setMine(loadTheme().theme);
  }, [pursuitId]);

  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.score), 1);

  return (
    <section>
      <h2 className="mb-1 font-semibold">Team standings</h2>
      <p className="mb-2 text-sm text-muted">
        Averaged per member, so a bigger team doesn&apos;t win by turning up.
      </p>
      <div className="card divide-y">
        {rows.map((r, i) => {
          const t = teamMeta(r.team);
          return (
            <div key={r.team} className="flex items-center gap-3 px-4 py-3">
              <span className="w-5 text-center font-bold text-faint">{i + 1}</span>
              <span className="text-xl">{t.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {t.label}
                  {r.team === mine && <span className="ml-1.5 text-xs font-normal text-accent">your team</span>}
                  <span className="ml-1.5 text-xs font-normal text-faint">
                    {r.members} member{r.members === 1 ? "" : "s"}
                  </span>
                </p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${(r.score / max) * 100}%`, background: t.color }} />
                </div>
                <p className="mt-0.5 text-xs text-faint">{r.detail}</p>
              </div>
              <span className="tabular-nums text-lg font-bold">{r.score}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Who's in this pursuit. Names link to profiles when you're allowed to open
 * them — for built-in pursuits like Life that's demo legends, friends and
 * track-mates, so the list shows how many others are in there without turning
 * the whole user base into a browsable directory.
 */
function MembersSection({ members, total }: { members: PursuitMember[]; total: number }) {
  const [expanded, setExpanded] = useState(false);
  if (members.length === 0) return null;
  const shown = expanded ? members : members.slice(0, 12);
  const hidden = total - members.length;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="font-semibold">Members</h2>
        <span className="text-sm text-faint">
          {total} in this pursuit
          {hidden > 0 && ` · ${hidden} not shown`}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {shown.map((m) => {
          const inner = (
            <>
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
                style={{ background: `${teamMeta(m.team).color}1f`, color: teamMeta(m.team).color }}
              >
                {m.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{m.displayName}</span>
                <span className="block truncate text-[10px] text-faint">
                  @{m.username}
                  {m.role === "owner" && " · owner"}
                  {m.isDemo && " · legend"}
                </span>
                {/* who's active vs a ghost — the ONE bit of info a member card
                    was missing. Tone colours a hot/warm/cold chip. */}
                {(() => {
                  const ll = lastLoggedLabel(m.lastLogged, localToday());
                  const tint = ll.tone === "hot" ? "text-ok" : ll.tone === "warm" ? "text-warn" : "text-faint";
                  return <span className={`block truncate text-[10px] ${tint}`}>· {ll.text}</span>;
                })()}
              </span>
            </>
          );
          return m.isVisible ? (
            <Link
              key={m.memberId}
              href={`/friends/${m.memberId}`}
              className="flex max-w-[13rem] items-center gap-2 rounded-xl border bg-surface px-3 py-2 transition hover:-translate-y-0.5 hover:text-accent"
            >
              {inner}
            </Link>
          ) : (
            <span
              key={m.memberId}
              title="Add them as a friend to see their profile"
              className="flex max-w-[13rem] items-center gap-2 rounded-xl border bg-surface px-3 py-2 opacity-60"
            >
              {inner}
            </span>
          );
        })}
        {!expanded && members.length > 12 && (
          <button onClick={() => setExpanded(true)} className="rounded-xl border px-3 py-2 text-sm text-muted hover:text-accent">
            +{members.length - 12} more
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * The Life pursuit's community board: everyone's focus score and hours.
 * Built from leaderboard_day_totals — the same share-rule-enforcing function
 * the Arena uses, so nobody who set themselves to hidden ever shows up.
 */
function LifeCommunity({ pursuitId, memberCount }: { pursuitId: string; memberCount: number }) {
  const todayISO = localToday();
  const ws = weekStart(todayISO);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Only the last ~12 weeks — the charts show six, the boards need a bit of
  // headroom, and pulling everyone's whole history here used to time out.
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

  // ranked on WorkMax, not focus score — a spotless 5-hour week shouldn't
  // outrank a spotless 40-hour one
  const topWeek = useMemo(
    () => [...people].filter((p) => p.weekWorkMax != null).sort((a, b) => (b.weekWorkMax ?? 0) - (a.weekWorkMax ?? 0)).slice(0, 5),
    [people]
  );
  const topAllTime = useMemo(() => [...people].sort((a, b) => (b.allWorkMax ?? 0) - (a.allWorkMax ?? 0)).slice(0, 5), [people]);

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
        <div className="h-64 card p-2">
          <ResponsiveContainer>
            <BarChart data={[...people].sort((a, b) => b.weekP - a.weekP).slice(0, 8).map((p) => ({ name: p.name, productive: Math.round(p.weekP * 10) / 10, brainrot: Math.round(p.weekB * 10) / 10 }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} unit="h" />
              <Tooltip />
              <Legend />
              <Bar dataKey="productive" fill="var(--accent)" />
              <Bar dataKey="brainrot" fill={CHART_DANGER} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </>
  );
}

/** The Lifts pursuit's community board: who lifts what, and how it's moving. */
function LiftsCommunity({ pursuitId }: { pursuitId: string }) {
  const [rows, setRows] = useState<LeaderboardLiftRow[]>([]);
  const [exercise, setExercise] = useState("");
  const [loading, setLoading] = useState(true);

  // last year of sessions — enough to show progression without hauling
  // everyone's entire lifting history across the wire
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

function StatSection({ stat, isOwner, isMember, onChanged, mineOnly }: { stat: PursuitStat; isOwner: boolean; isMember: boolean; onChanged: () => void; mineOnly?: boolean }) {
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
