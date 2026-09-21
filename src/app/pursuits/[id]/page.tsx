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
import MineView from "./_mine-view";
import StatSection from "./_stat-section";
import { LifeCommunity, LiftsCommunity } from "./_community";

const MONEY_PURSUIT_ID = "33333333-3333-4333-8333-333333333305";


const tickDate = (d: string) => (typeof d === "string" ? d.slice(5) : d);


/**
 * "3d ago", "today", "no logs" — the point is to see who's ACTIVE
 * without doing calendar arithmetic in your head.
 *
 * The chip returns a `title` string too, so hovering a member card
 * on desktop tells you exactly what the label refers to (log dates
 * on THIS pursuit's tables -- day_entries for Life, spend_entries
 * for Money, pursuit_entries for custom). The previous "never" was
 * confusing on a brand-new custom pursuit where nobody has logged
 * yet: it read as "these people have never logged anything on
 * DayMax", not "nobody has entered a data point on this pursuit".
 */
function lastLoggedLabel(iso: string | null, today: string): { text: string; tone: "hot" | "warm" | "cold" | "none"; title: string } {
  if (!iso) return { text: "no logs here yet", tone: "none", title: "Hasn't logged anything on this pursuit yet" };
  const d = (a: string) => new Date(a + "T00:00:00").getTime();
  const days = Math.max(0, Math.round((d(today) - d(iso)) / 86400000));
  const title = `Last logged on this pursuit ${iso}`;
  if (days === 0) return { text: "today", tone: "hot", title };
  if (days === 1) return { text: "yesterday", tone: "hot", title };
  if (days < 7) return { text: `${days}d ago`, tone: "warm", title };
  if (days < 30) return { text: `${Math.round(days / 7)}w ago`, tone: "cold", title };
  return { text: `${Math.round(days / 30)}mo ago`, tone: "cold", title };
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
 * Light vs Midnight vs Cottage, for this pursuit. Ranked on FOCUS %
 * (productive / (productive + brainrot)) rather than raw WorkMax
 * so a team that's been logging for two weeks isn't eating a team
 * that joined yesterday. WorkMax is volume-heavy: someone with 100h
 * productive beats someone with 5h productive by 20x even at the
 * same quality. Focus is volume-neutral -- 1h/0h scores 100%, 100h/0h
 * also scores 100% -- so it's a fair comparison when teams have
 * been in for different amounts of time.
 *
 * The server RPC still returns WorkMax (score) + the hours in the
 * detail string; we parse the hours out of detail and compute focus
 * client-side. Non-life pursuits (Money, Lifts, custom stats) don't
 * have 'productive/brainrot' hours to parse, so they keep the raw
 * server score and read as before.
 */
function TeamStandings({ pursuitId }: { pursuitId: string }) {
  const [rows, setRows] = useState<TeamStanding[]>([]);
  const [mine, setMine] = useState<Team | null>(null);

  useEffect(() => {
    fetchPursuitTeams(pursuitId).then(setRows).catch(() => {});
    setMine(loadTheme().theme);
  }, [pursuitId]);

  if (rows.length === 0) return null;

  // Detail format on the life pursuit: "1982h productive · 482h brainrot".
  const HOURS_RE = /([\d.]+)\s*h\s*productive\s*·\s*([\d.]+)\s*h\s*brainrot/i;
  const hasFocus = rows.every((r) => HOURS_RE.test(r.detail));

  const ranked = hasFocus
    ? [...rows]
        .map((r) => {
          const m = r.detail.match(HOURS_RE)!;
          const p = Number(m[1]);
          const b = Number(m[2]);
          const focus = p + b > 0 ? (p / (p + b)) * 100 : 0;
          return { ...r, focus };
        })
        .sort((a, b) => b.focus - a.focus)
    : rows.map((r) => ({ ...r, focus: undefined as number | undefined }));

  const max = hasFocus
    ? Math.max(...ranked.map((r) => r.focus ?? 0), 1)
    : Math.max(...ranked.map((r) => r.score), 1);

  return (
    <section>
      <h2 className="mb-1 font-semibold">Team standings</h2>
      <p className="mb-2 text-sm text-muted">
        {hasFocus
          ? "Focus % (productive ÷ productive + brainrot). Volume-neutral, so a team that's been logging longer doesn't win by default."
          : "Averaged per member, so a bigger team doesn't win by turning up."}
      </p>
      <div className="card divide-y">
        {ranked.map((r, i) => {
          const t = teamMeta(r.team);
          const shownValue = hasFocus ? r.focus ?? 0 : r.score;
          const barWidth = hasFocus
            ? shownValue // focus is already 0..100
            : (r.score / max) * 100;
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
                  <div className="h-full rounded-full" style={{ width: `${barWidth}%`, background: t.color }} />
                </div>
                <p className="mt-0.5 text-xs text-faint">{r.detail}</p>
              </div>
              <span className="tabular-nums text-lg font-bold">
                {hasFocus ? `${shownValue.toFixed(1)}%` : shownValue}
              </span>
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
      {/* Old 'Nobody has logged anything on this pursuit yet -- the
          "no logs here yet" chip means just that' hint lived here.
          Killed on feedback ('redundant'), together with the chip
          it was explaining -- see the member card render below. A
          card with no chip now reads simply as 'this person hasn't
          logged anything', which is what the row was trying to say
          the long way. */}
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
                {/* Active-vs-ghost chip. Renders ONLY when the
                    person has actually logged something here -- a
                    'no logs here yet' chip on every unlogged member
                    was repeated on every card and read as noise. A
                    card without a chip now reads the same story
                    without saying it. */}
                {m.lastLogged && (() => {
                  const ll = lastLoggedLabel(m.lastLogged, localToday());
                  const tint = ll.tone === "hot" ? "text-ok" : ll.tone === "warm" ? "text-warn" : "text-faint";
                  return <span title={ll.title} className={`block truncate text-[10px] ${tint}`}>· {ll.text}</span>;
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

