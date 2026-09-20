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
import BigThree from "./big-three";
import DayClock, { type ClockSlot } from "./day-clock";

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

  const [myChallenges, setMyChallenges] = useState<Array<{ id: string; name: string; daysLeft: number }>>([]);
  useEffect(() => {
    // only the ones this person is actually in; the board is public anyway
    import("@/lib/money")
      .then((m) => m.fetchChallenges())
      .then((cs) => setMyChallenges(cs.filter((c) => c.isMember).map((c) => ({ id: c.id, name: c.name, daysLeft: c.daysLeft }))))
      .catch(() => {});
  }, [userId]);

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

      {(pursuits.length > 0 || myChallenges.length > 0) && (
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
          {myChallenges.length > 0 && (
            <>
              <h3 className="mb-2 mt-3 text-xs font-semibold uppercase tracking-wide text-faint">Challenges</h3>
              <div className="flex flex-wrap gap-2">
                {myChallenges.map((c) => (
                  <Link
                    key={c.id}
                    href={`/challenges/${c.id}`}
                    className="rounded-full border bg-surface px-3 py-1.5 text-sm font-medium hover:text-accent"
                  >
                    {c.name}
                    {c.daysLeft > 0 ? (
                      <span className="ml-1 text-xs font-semibold text-accent">{c.daysLeft}d left</span>
                    ) : (
                      <span className="ml-1 text-xs text-faint">final</span>
                    )}
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* The signature picture of the app. Standard on every profile now,
          directly under Pursuits, rather than buried four sections down and
          hidden unless the owner had left the "days" section switched on. */}
      {strip.length > 0 && <TypicalDay strip={strip} name={name} isSelf={isSelf} />}

      {strip.length > 0 && <ProfileYearBars strip={strip} name={name} isSelf={isSelf} />}


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

      {/* the big three together, before the single-exercise picker */}
      {show("lifts") && liftRows.length > 0 && (
        <BigThree
          rows={liftRows}
          bodyweightKg={bodyweight.length ? bodyweight[bodyweight.length - 1].weightKg : null}
          title={isSelf ? "Your big three" : `${name}'s big three`}
        />
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

      {/* "Their days, 15 minutes at a time" (a second month grid) and the
          year heatmap were both saying what the year strip above already says,
          three sections further down the page. Gone. */}

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

/**
 * The typical day, as a clock.
 *
 * Every logged day collapsed onto one dial: for each quarter hour, the thing
 * this person does most often at that time, and how often. The year strip
 * shows every day; this shows the SHAPE all those days have in common, which
 * is a different question and the more interesting one.
 */
function TypicalDay({ strip, name, isSelf }: { strip: DayStripRow[]; name: string; isSelf: boolean }) {
  const { slots, days, headline } = useMemo(() => {
    const perSlot = new Map<number, Map<number, number>>();
    const dates = new Set<string>();
    for (const r of strip) {
      dates.add(r.date);
      if (!perSlot.has(r.slot)) perSlot.set(r.slot, new Map());
      const m = perSlot.get(r.slot)!;
      m.set(r.category, (m.get(r.category) ?? 0) + 1);
    }
    const out = new Map<number, ClockSlot>();
    let peak: { slot: number; cat: number; share: number } | null = null;
    for (const [slot, counts] of perSlot) {
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      const [cat, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      const share = Math.round((n / total) * 100);
      out.set(slot, { category: cat, hint: `${share}% of days` });
      // the most predictable moment in the day makes the best headline
      if (!peak || share > peak.share) peak = { slot, cat, share };
    }
    return {
      slots: out,
      days: dates.size,
      headline: peak,
    };
  }, [strip]);

  if (slots.size === 0) return null;
  const who = isSelf ? "You" : name;

  return (
    <section>
      <h2 className="mb-1 font-semibold">{isSelf ? "Your typical day" : `${name}'s typical day`}</h2>
      <p className="mb-2 text-sm text-muted">
        {days.toLocaleString()} days collapsed onto one dial — the most common thing at each quarter hour.
        {headline && (
          <>
            {" "}
            The most predictable moment is <b>{slotToTime(headline.slot)}</b>: {who.toLowerCase() === "you" ? "you are" : "they are"}{" "}
            {categoryName(headline.cat).toLowerCase()} on <b>{headline.share}%</b> of days.
          </>
        )}
      </p>
      <DayClock slots={slots} />
    </section>
  );
}

/** The whole year at a glance: every logged day as a slim vertical 96-slot bar. */
function ProfileYearBars({ strip, name, isSelf }: { strip: DayStripRow[]; name: string; isSelf: boolean }) {
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

  const year = days.length ? days[days.length - 1][0].slice(0, 4) : new Date().getFullYear();
  const totals = useMemo(() => {
    const h = new Map<number, number>();
    for (const r of strip) h.set(r.category, (h.get(r.category) ?? 0) + 0.25);
    return [...h.entries()].sort((a, b) => b[1] - a[1]);
  }, [strip]);
  const logged = totals.reduce((s, [, v]) => s + v, 0);

  return (
    <section>
      <h2 className="mb-1 font-semibold">
        {isSelf ? `My ${year} in 15-minute slots` : `${name}'s ${year} in 15-minute slots`}
      </h2>
      <p className="mb-2 text-sm text-muted">
        {days.length.toLocaleString()} days · {Math.round(logged).toLocaleString()} hours accounted for. Hover any slot for detail.
      </p>
      {/* One column per day, all of them, fitted to the card. It used to be a
          fixed 13px per day inside overflow-x-auto, so a year was 3,350px of
          sideways scrolling and you could never see the shape of it at once.
          minWidth:0 on the children is load-bearing: flex items default to
          min-width:auto and refuse to shrink below their content. */}
      <div className="card p-4">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
            gap: days.length > 180 ? 0 : 1,
            width: "100%",
          }}
        >
          {days.map(([date, d]) => (
            <div key={date} className="flex h-[260px] flex-col overflow-hidden" style={{ minWidth: 0 }}>
              {d.slots.map((cat, s) => (
                <div
                  key={s}
                  title={`${date} ${slotToTime(s)}${cat != null ? ` — ${categoryName(cat)}${d.labels[s] ? ` (${d.labels[s]})` : ""}` : ""}`}
                  className="w-full flex-1"
                  style={{ background: cat != null ? categoryColor(cat) : "var(--surface-2)", minHeight: 0 }}
                />
              ))}
            </div>
          ))}
        </div>
        {/* months, rather than 258 unreadable vertical dates */}
        <div
          className="mt-1"
          style={{ display: "grid", gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
        >
          {days.map(([date], i) => {
            const first = i === 0 || days[i - 1][0].slice(5, 7) !== date.slice(5, 7);
            return (
              <span key={date} className="overflow-visible whitespace-nowrap text-[9px] text-faint" style={{ minWidth: 0 }}>
                {first ? MONTHS[Number(date.slice(5, 7)) - 1] : ""}
              </span>
            );
          })}
        </div>
      </div>
      {/* a legend, so the colours mean something without opening another page */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {totals.map(([cat, h]) => (
          <span key={cat} className="inline-flex items-center gap-1.5 text-xs text-muted">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: categoryColor(cat) }} />
            {categoryName(cat)}
            <span className="tabular-nums text-faint">{Math.round(h).toLocaleString()}h</span>
          </span>
        ))}
      </div>
    </section>
  );
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];


const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

