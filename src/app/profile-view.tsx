"use client";

/**
 * A friend's profile: only the sections THEY chose to show (default:
 * productivity ranking, hours, lifts), and only if you share a track.
 * All numbers come through the same share-rule-enforcing SQL functions.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  acceptFriendRequest,
  fetchMemberDayMetrics,
  fetchMemberDayStrip,
  fetchMemberBodyweight,
  fetchMemberDayTotals,
  fetchMemberExercises,
  fetchMemberLifts,
  setDefaultExercise,
  fetchMemberProfile,
  sendFriendRequest,
  type CompareLiftRow,
  type DayStripRow,
  type FriendStatus,
  type MemberDayMetricsRow,
  type MemberDayTotal,
  type ProfileSection,
} from "@/lib/friends";
import { CATEGORIES, categoryColor, categoryName, slotToTime, SLOTS_PER_DAY } from "@/lib/categories";
import { fetchMemberPursuits, type MemberPursuit } from "@/lib/pursuits";
import { weekStart, workMaxFrom } from "@/lib/ranking";
import { blendHex, DEFAULT_BUCKET_COLORS, loadBucketColors, type BucketColors } from "@/lib/theme";
import { teamMeta } from "@/lib/teams";
import { TeamDot } from "./team-name";
import { defaultBuckets, HOURS_PER_SLOT } from "@/lib/categories";
import { localToday } from "@/lib/dates";

const LINE_COLORS = ["#4f6ef7", "#16a34a", "#dc2626", "#f59e0b", "#0ea5e9"];
const tickDate = (d: string) => (typeof d === "string" ? d.slice(5) : d);

export default function ProfileView({ userId }: { userId: string }) {
  const todayISO = localToday();
  const ws = weekStart(todayISO);

  const [name, setName] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [sections, setSections] = useState<ProfileSection[]>([]);
  const [friendStatus, setFriendStatus] = useState<FriendStatus>("none");
  const [isSelf, setIsSelf] = useState(false);
  const [dayRows, setDayRows] = useState<MemberDayTotal[]>([]);
  const [liftRows, setLiftRows] = useState<CompareLiftRow[]>([]);
  const [strip, setStrip] = useState<DayStripRow[]>([]);
  const [memberMetrics, setMemberMetrics] = useState<MemberDayMetricsRow[]>([]);
  const [pursuits, setPursuits] = useState<MemberPursuit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [colors, setColors] = useState<BucketColors>(DEFAULT_BUCKET_COLORS);
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const [exercise, setExercise] = useState("");
  const [busy, setBusy] = useState(false);
  const [team, setTeam] = useState("light");
  const [bodyweight, setBodyweight] = useState<Array<{ date: string; weightKg: number }>>([]);
  const [exercises, setExercises] = useState<Array<{ exercise: string; sessions: number; best: number }>>([]);
  const [defaultEx, setDefaultEx] = useState<string | null>(null);

  function load() {
    fetchMemberProfile(userId)
      .then((profile) => {
        setName(profile.displayName);
        setUsername(profile.username);
        setSections(profile.sections);
        setFriendStatus(profile.friendStatus);
        setIsSelf(profile.isSelf);
        setTeam(profile.team);
        setDefaultEx(profile.defaultExercise);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }

  useEffect(() => {
    if (!userId) return;
    setColors(loadBucketColors());
    load();
    // Every section reads through its own visibility-gated function, so these
    // all fire at once and each simply returns nothing if it's not shared —
    // no more hunting for a shared track first.
    fetchMemberDayTotals(userId).then(setDayRows).catch(() => {});
    fetchMemberDayStrip(userId).then(setStrip).catch(() => {});
    fetchMemberDayMetrics(userId).then(setMemberMetrics).catch(() => {});
    fetchMemberPursuits(userId).then(setPursuits).catch(() => {});
    fetchMemberBodyweight(userId).then(setBodyweight).catch(() => {});
    fetchMemberExercises(userId).then(setExercises).catch(() => {});
    fetchMemberLifts(userId)
      .then((lifts) => {
        setLiftRows(lifts);
        if (lifts.length) {
          const counts = new Map<string, number>();
          for (const r of lifts) counts.set(r.exercise, (counts.get(r.exercise) ?? 0) + 1);
          // the owner's chosen default wins; otherwise their most-logged lift
          setExercise((prev) => prev || [...counts.entries()].sort(([, a], [, b]) => b - a)[0][0]);
        }
      })
      .catch(() => {});
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // the profile owner's chosen default lift takes precedence over "most logged"
  useEffect(() => {
    if (defaultEx) setExercise(defaultEx);
  }, [defaultEx]);

  const agg = (list: MemberDayTotal[]) => {
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

  const ranking = useMemo(
    () => [
      { label: "Today", ...agg(dayRows.filter((r) => r.date === todayISO)) },
      { label: "This week", ...agg(dayRows.filter((r) => r.date >= ws && r.date <= todayISO)) },
      { label: "All time", ...agg(dayRows) },
    ],
    [dayRows, todayISO, ws]
  );

  const hoursChart = useMemo(() => {
    const keyOf = (d: string) => (period === "day" ? d : period === "week" ? weekStart(d) : d.slice(0, 7));
    const byKey = new Map<string, { productive: number; brainrot: number; other: number }>();
    for (const r of dayRows) {
      const k = keyOf(r.date);
      const cur = byKey.get(k) ?? { productive: 0, brainrot: 0, other: 0 };
      cur.productive += r.productive;
      cur.brainrot += r.brainrot;
      cur.other += r.other;
      byKey.set(k, cur);
    }
    const keep = period === "day" ? 42 : period === "week" ? 30 : 24;
    return [...byKey.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(-keep)
      .map(([k, v]) => ({ label: period === "month" ? k : k.slice(5), ...v }));
  }, [dayRows, period]);

  // union of what they've logged and what the server reports, so the picker
  // still works if one of the two calls fails
  const exerciseNames = useMemo(
    () => [...new Set([...liftRows.map((r) => r.exercise), ...exercises.map((e) => e.exercise)])].sort(),
    [liftRows, exercises]
  );
  const liftChart = useMemo(
    () =>
      liftRows
        .filter((r) => r.exercise === exercise && r.weightKg != null)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((r) => ({ date: r.date, weight: r.weightKg })),
    [liftRows, exercise]
  );

  if (error)
    return (
      <div className="mx-auto max-w-md card p-6 text-center">
        <h1 className="mb-1 text-lg font-semibold">This profile is private</h1>
        <p className="text-sm text-muted">
          They&apos;ve chosen not to show their page publicly. Send a friend request and they can share it with you.
        </p>
        <Link href="/search" className="mt-3 inline-block text-sm font-medium text-accent hover:underline">
          ← Back to search
        </Link>
      </div>
    );
  if (!name) return <p className="text-sm text-muted">Loading profile…</p>;

  const show = (s: ProfileSection) => sections.includes(s);
  const hasDayData = dayRows.length > 0;

  async function friendAction() {
    setBusy(true);
    try {
      if (friendStatus === "none") await sendFriendRequest(userId);
      else if (friendStatus === "pending_in") {
        const { listFriends } = await import("@/lib/friends");
        const fs = await listFriends();
        const match = fs.find((f) => f.memberId === userId && f.status === "pending");
        if (match) await acceptFriendRequest(match.friendshipId);
      }
      load();
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold"
          style={{ background: `${teamMeta(team).color}1f`, color: teamMeta(team).color }}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {name}
            <TeamDot team={team} className="h-2 w-2" />
          </h1>
          <p className="text-sm text-faint">
            {username && <>@{username} · </>}
            <span style={{ color: teamMeta(team).color }}>{teamMeta(team).label}</span>
          </p>
        </div>

        {!isSelf && (
          <div className="ml-auto">
            {friendStatus === "friends" && (
              <span className="rounded-full bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent">✓ Friends</span>
            )}
            {friendStatus === "pending_out" && (
              <span className="rounded-full border px-3 py-1.5 text-sm text-muted">Request sent</span>
            )}
            {friendStatus === "pending_in" && (
              <button onClick={() => void friendAction()} disabled={busy} className="btn-primary py-1.5">
                {busy ? "…" : "Accept request"}
              </button>
            )}
            {friendStatus === "none" && (
              <button onClick={() => void friendAction()} disabled={busy} className="btn-primary py-1.5">
                {busy ? "…" : "Add friend"}
              </button>
            )}
          </div>
        )}
        {isSelf && (
          <Link href="/settings" className="ml-auto btn-ghost py-1.5">Edit profile</Link>
        )}
      </div>

      {!isSelf && friendStatus !== "friends" && (
        <p className="-mt-4 text-sm text-faint">
          You&apos;re seeing {name}&apos;s public profile. Friends may see more.
        </p>
      )}

      {pursuits.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Pursuits</h2>
          <div className="flex flex-wrap gap-2">
            {pursuits.map((p) => (
              <Link
                key={p.id}
                href={`/pursuits/${p.id}`}
                className="rounded-full border bg-surface px-3 py-1.5 text-sm font-medium hover:text-accent"
              >
                {p.name} <span className="text-xs text-faint">· {p.memberCount}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {show("ranking") && hasDayData && (
        <section>
          <h2 className="mb-2 font-semibold">Productivity ranking</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {ranking.map((r) => (
              <div key={r.label} className="card p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">{r.label}</h3>
                <p className="mt-1 text-2xl font-bold tabular-nums">{r.workMax ?? "—"}<span className="text-xs font-normal text-faint"> WorkMax</span></p>
                <p className="text-xs text-muted">focus {r.score ?? "—"}/100</p>
                <p className="text-xs text-muted">
                  <span style={{ color: colors.productive }}>{r.p.toFixed(1)}h</span> productive ·{" "}
                  <span style={{ color: colors.brainrot }}>{r.b.toFixed(1)}h</span> brainrot
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {show("hours") && hasDayData && (
        <section>
          <div className="mb-2 flex items-center gap-3">
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
              <BarChart data={hoursChart}>
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

      {show("lifts") && liftRows.length > 0 && (
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">Lifts</h2>
            <select value={exercise} onChange={(e) => setExercise(e.target.value)} className="rounded-lg border bg-surface px-2 py-1 text-sm">
              {exerciseNames.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
            {isSelf && exercise && exercise !== defaultEx && (
              <button
                onClick={() => void setDefaultExercise(exercise).then(() => setDefaultEx(exercise))}
                className="text-xs font-medium text-accent hover:underline"
              >
                make this my default
              </button>
            )}
            {isSelf && exercise && exercise === defaultEx && <span className="text-xs text-faint">your default</span>}
          </div>
          <div className="h-56 card p-2">
            <ResponsiveContainer>
              <LineChart data={liftChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} unit="kg" />
                <Tooltip labelFormatter={(d) => String(d)} />
                <Line type="monotone" strokeWidth={2.5} dataKey="weight" stroke={LINE_COLORS[0]} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {show("lifts") && bodyweight.length > 1 && (
        <section>
          <h2 className="mb-1 font-semibold">Bodyweight</h2>
          <p className="mb-2 text-sm text-muted">Standard on every profile — the one number every lifter has in common.</p>
          <div className="h-52 card p-2">
            <ResponsiveContainer>
              <LineChart data={bodyweight}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} unit="kg" />
                <Tooltip labelFormatter={(d) => String(d)} formatter={(v: number) => [`${v} kg`, "bodyweight"]} />
                <Line type="monotone" strokeWidth={2.5} dataKey="weightKg" stroke={teamMeta(team).color} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {show("days") && strip.length > 0 && <ProfileYearHeatmap strip={strip} />}

      {show("days") && strip.length > 0 && <ProfileDayStrip name={name} strip={strip} />}

      {show("days") && strip.length > 0 && <ProfileYearBars strip={strip} />}

      {show("metrics") && memberMetrics.length > 2 && <ProfileMetricsChart name={name} rows={memberMetrics} />}

      {!hasDayData && liftRows.length === 0 && strip.length === 0 && (
        <p className="card p-4 text-sm text-faint">
          {sections.length === 0
            ? `${name} hasn't shared anything publicly.`
            : `Nothing here yet — ${name} hasn't logged anything.`}
        </p>
      )}
    </div>
  );
}

/** The whole year at a glance: every logged day as a slim vertical 96-slot bar. */
function ProfileYearBars({ strip }: { strip: DayStripRow[] }) {
  const days = useMemo(() => {
    const byDate = new Map<string, { slots: (number | null)[]; labels: (string | null)[] }>();
    for (const r of strip) {
      if (!byDate.has(r.date)) byDate.set(r.date, { slots: new Array(SLOTS_PER_DAY).fill(null), labels: new Array(SLOTS_PER_DAY).fill(null) });
      const d = byDate.get(r.date)!;
      d.slots[r.slot] = r.category;
      d.labels[r.slot] = r.label;
    }
    return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [strip]);

  return (
    <section>
      <h2 className="mb-1 font-semibold">The whole year</h2>
      <p className="mb-2 text-sm text-muted">{days.length.toLocaleString()} days side by side — scroll through their year, hover for detail.</p>
      <div className="card overflow-x-auto p-4">
        <div className="flex items-end gap-[3px]" style={{ minWidth: days.length * 13 }}>
          {days.map(([date, d]) => (
            <div key={date} className="flex flex-col items-center">
              <div className="flex h-[288px] w-[10px] flex-col overflow-hidden rounded-full">
                {d.slots.map((cat, s) => (
                  <div
                    key={s}
                    title={`${date} ${slotToTime(s)}${cat != null ? ` — ${categoryName(cat)}${d.labels[s] ? ` (${d.labels[s]})` : ""}` : ""}`}
                    className="w-full flex-1"
                    style={{ background: cat != null ? categoryColor(cat) : "var(--surface-2)" }}
                  />
                ))}
              </div>
              <span className="mt-1 text-[8px] text-faint" style={{ writingMode: "vertical-rl" }}>
                {date.slice(5)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const METRIC_LINES: Array<{ key: keyof MemberDayMetricsRow; label: string; color: string }> = [
  { key: "emotionalScore", label: "Emotion", color: "#4f6ef7" },
  { key: "tired", label: "Tired", color: "#dc2626" },
  { key: "startFriction", label: "Start friction", color: "#f59e0b" },
  { key: "endBrainFatigue", label: "Brain fatigue", color: "#a78bfa" },
];

/** Emotional score & friends over time — the good stuff. */
function ProfileMetricsChart({ name, rows }: { name: string; rows: MemberDayMetricsRow[] }) {
  return (
    <section>
      <h2 className="mb-1 font-semibold">How {name} felt</h2>
      <p className="mb-2 text-sm text-muted">Emotional score, tiredness, start friction and brain fatigue, out of 10.</p>
      <div className="h-64 card p-2">
        <ResponsiveContainer>
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
            <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
            <Tooltip labelFormatter={(d) => String(d)} />
            <Legend />
            {METRIC_LINES.map((m) => (
              <Line key={m.key} type="monotone" strokeWidth={2.5} dataKey={m.key} name={m.label} stroke={m.color} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/** Read-only month grid (like the Month page): reliable hover, optional inline text. */
function ProfileDayStrip({ name, strip }: { name: string; strip: DayStripRow[] }) {
  const byDate = useMemo(() => {
    const map = new Map<string, Map<number, { category: number; label: string | null }>>();
    for (const r of strip) {
      if (!map.has(r.date)) map.set(r.date, new Map());
      map.get(r.date)!.set(r.slot, { category: r.category, label: r.label });
    }
    return map;
  }, [strip]);

  const months = useMemo(() => [...new Set([...byDate.keys()].map((d) => d.slice(0, 7)))].sort(), [byDate]);
  const [ym, setYm] = useState<string>("");
  const [showText, setShowText] = useState(false);
  const month = ym || months[months.length - 1] || "";

  const dates = useMemo(() => {
    if (!month) return [];
    const [y, m] = month.split("-").map(Number);
    const n = new Date(y, m, 0).getDate();
    return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  }, [month]);

  if (months.length === 0) return null;

  return (
    <section>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Their days, 15 minutes at a time</h2>
        <select value={month} onChange={(e) => setYm(e.target.value)} className="rounded-lg border bg-surface px-2 py-1 text-sm">
          {months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <button
          onClick={() => setShowText((v) => !v)}
          className={`rounded-lg border px-2.5 py-1 text-sm ${showText ? "bg-accent-soft font-semibold text-accent" : ""}`}
          title="Show activity text in cells"
        >
          Aa
        </button>
      </div>
      <p className="mb-2 text-sm text-muted">{name} shares full day detail. Hover any cell — or hit Aa to read it straight off the grid.</p>
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {CATEGORIES.map((c) => (
          <span key={c.code} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />
            {c.name}
          </span>
        ))}
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-xl border bg-surface">
        <table className="daygrid border-collapse">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="sticky left-0 z-20 bg-surface px-1 py-1">time</th>
              {dates.map((d) => (
                <th key={d} style={{ minWidth: showText ? 90 : 34 }} className="px-1 py-1">
                  {Number(d.slice(8))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: SLOTS_PER_DAY }, (_, s) => (
              <tr key={s}>
                <td className="sticky left-0 z-10 bg-surface px-1 text-right font-mono text-[10px] text-faint">
                  {s % 4 === 0 ? slotToTime(s) : ""}
                </td>
                {dates.map((date) => {
                  const c = byDate.get(date)?.get(s);
                  return (
                    <td
                      key={date}
                      title={c ? `${date} ${slotToTime(s)} — ${categoryName(c.category)}${c.label ? `: ${c.label}` : ""}` : `${date} ${slotToTime(s)}`}
                      className="overflow-hidden whitespace-nowrap align-middle"
                      style={{ height: 13, maxWidth: showText ? 90 : 34, background: c ? categoryColor(c.category) + "dd" : undefined }}
                    >
                      {showText && c?.label ? (
                        <span className="block truncate px-0.5 text-[9px] font-medium text-white/95" style={{ lineHeight: "13px" }}>
                          {c.label}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Year heatmap: productive-vs-brainrot blend or dominant category, per day. */
function ProfileYearHeatmap({ strip }: { strip: DayStripRow[] }) {
  const [mode, setMode] = useState<"buckets" | "dominant">("buckets");
  const colors = useMemo(() => (typeof window === "undefined" ? DEFAULT_BUCKET_COLORS : loadBucketColors()), []);
  const buckets = useMemo(() => defaultBuckets(), []);

  const byDate = useMemo(() => {
    const map = new Map<string, DayStripRow[]>();
    for (const r of strip) map.set(r.date, [...(map.get(r.date) ?? []), r]);
    return map;
  }, [strip]);

  const years = useMemo(() => [...new Set([...byDate.keys()].map((d) => Number(d.slice(0, 4))))].sort(), [byDate]);
  const [year, setYear] = useState<number>(0);
  const y = year || years[years.length - 1] || new Date().getFullYear();

  function cell(date: string) {
    const list = byDate.get(date);
    if (!list) return null;
    const catHours = new Map<number, number>();
    let p = 0, b = 0;
    for (const e of list) {
      catHours.set(e.category, (catHours.get(e.category) ?? 0) + HOURS_PER_SLOT);
      const bk = buckets[e.category] ?? "other";
      if (bk === "productive") p += HOURS_PER_SLOT;
      else if (bk === "brainrot") b += HOURS_PER_SLOT;
    }
    const opacity = Math.min(1, list.length / 96 + 0.25);
    if (mode === "dominant") {
      const top = [...catHours.entries()].sort(([, a2], [, b2]) => b2 - a2)[0];
      return { color: categoryColor(top[0]), opacity, tip: `${date}: mostly ${categoryName(top[0])} (${top[1].toFixed(1)}h)` };
    }
    if (p + b === 0) return { color: "var(--faint)", opacity: 0.35, tip: `${date}: nothing productive or brainrot` };
    return {
      color: blendHex(colors.brainrot, colors.productive, p / (p + b)),
      opacity,
      tip: `${date}: ${p.toFixed(1)}h productive, ${b.toFixed(1)}h brainrot`,
    };
  }

  if (years.length === 0) return null;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Year at a glance</h2>
        {years.length > 1 && (
          <select value={y} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border bg-surface px-2 py-1 text-sm">
            {years.map((yy) => (
              <option key={yy} value={yy}>{yy}</option>
            ))}
          </select>
        )}
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
          {(["buckets", "dominant"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`rounded-lg px-3 py-1 ${mode === m ? "bg-surface font-semibold" : "text-muted"}`}>
              {m === "buckets" ? "Productive vs brainrot" : "Dominant category"}
            </button>
          ))}
        </div>
      </div>
      <div className="card overflow-x-auto p-4">
        <table className="border-separate" style={{ borderSpacing: 3 }}>
          <thead>
            <tr>
              <th className="pr-2 text-left text-xs font-medium text-faint">·</th>
              {Array.from({ length: 31 }, (_, i) => (
                <th key={i} className="text-center text-[10px] font-normal text-faint">{i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MONTH_NAMES.map((mn, mi) => {
              const daysInMonth = new Date(y, mi + 1, 0).getDate();
              const ym = `${y}-${String(mi + 1).padStart(2, "0")}`;
              return (
                <tr key={mi}>
                  <td className="pr-2 text-xs font-medium text-muted">{mn}</td>
                  {Array.from({ length: 31 }, (_, i) => {
                    if (i >= daysInMonth) return <td key={i} />;
                    const date = `${ym}-${String(i + 1).padStart(2, "0")}`;
                    const c = cell(date);
                    return (
                      <td key={i}>
                        <div
                          title={c?.tip ?? `${date}: not logged`}
                          className="h-4 w-4 rounded-[4px]"
                          style={{ background: c ? c.color : "var(--surface-2)", opacity: c?.opacity ?? 1 }}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
