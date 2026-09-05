"use client";

/**
 * A friend's profile: only the sections THEY chose to show (default:
 * productivity ranking, hours, lifts), and only if you share a track.
 * All numbers come through the same share-rule-enforcing SQL functions.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  fetchCompareDay,
  fetchCompareLifts,
  fetchMemberProfile,
  fetchMembers,
  fetchTracks,
  type CompareDayRow,
  type CompareLiftRow,
  type ProfileSection,
} from "@/lib/friends";
import { weekStart } from "@/lib/ranking";
import { DEFAULT_BUCKET_COLORS, loadBucketColors, type BucketColors } from "@/lib/theme";

const LINE_COLORS = ["#4f6ef7", "#16a34a", "#dc2626", "#f59e0b", "#0ea5e9"];
const tickDate = (d: string) => (typeof d === "string" ? d.slice(5) : d);

export default function FriendProfilePage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;
  const todayISO = new Date().toISOString().slice(0, 10);
  const ws = weekStart(todayISO);

  const [name, setName] = useState<string | null>(null);
  const [sections, setSections] = useState<ProfileSection[]>([]);
  const [dayRows, setDayRows] = useState<CompareDayRow[]>([]);
  const [liftRows, setLiftRows] = useState<CompareLiftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [colors, setColors] = useState<BucketColors>(DEFAULT_BUCKET_COLORS);
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const [exercise, setExercise] = useState("");

  useEffect(() => {
    if (!userId) return;
    setColors(loadBucketColors());
    (async () => {
      try {
        const profile = await fetchMemberProfile(userId);
        setName(profile.displayName);
        setSections(profile.sections);
        // find a shared track to pull data through
        const tracks = await fetchTracks();
        let shared: string | null = null;
        for (const t of tracks) {
          const members = await fetchMembers(t.id);
          if (members.some((m) => m.userId === userId)) {
            shared = t.id;
            break;
          }
        }
        if (!shared) return;
        const [d, l] = await Promise.all([
          fetchCompareDay(shared).catch(() => [] as CompareDayRow[]),
          fetchCompareLifts(shared).catch(() => [] as CompareLiftRow[]),
        ]);
        setDayRows(d.filter((r) => r.memberId === userId));
        const lifts = l.filter((r) => r.memberId === userId);
        setLiftRows(lifts);
        if (lifts.length) {
          const counts = new Map<string, number>();
          for (const r of lifts) counts.set(r.exercise, (counts.get(r.exercise) ?? 0) + 1);
          setExercise([...counts.entries()].sort(([, a], [, b]) => b - a)[0][0]);
        }
      } catch (e: any) {
        setError(String(e.message ?? e));
      }
    })();
  }, [userId]);

  const agg = (list: CompareDayRow[]) => {
    const p = list.reduce((s, r) => s + r.productive, 0);
    const b = list.reduce((s, r) => s + r.brainrot, 0);
    const o = list.reduce((s, r) => s + r.other, 0);
    return { p, b, o, score: p + b > 0 ? Math.round((p / (p + b)) * 1000) / 10 : null };
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

  const exercises = useMemo(() => [...new Set(liftRows.map((r) => r.exercise))].sort(), [liftRows]);
  const liftChart = useMemo(
    () =>
      liftRows
        .filter((r) => r.exercise === exercise && r.weightKg != null)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((r) => ({ date: r.date, weight: r.weightKg })),
    [liftRows, exercise]
  );

  if (error) return <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>;
  if (!name) return <p className="text-sm text-muted">Loading profile…</p>;

  const show = (s: ProfileSection) => sections.includes(s);
  const hasDayData = dayRows.length > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{name}</h1>
        <p className="text-sm text-muted">Showing only what {name} chose to share.</p>
      </div>

      {show("ranking") && hasDayData && (
        <section>
          <h2 className="mb-2 font-semibold">Productivity ranking</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {ranking.map((r) => (
              <div key={r.label} className="card p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">{r.label}</h3>
                <p className="mt-1 text-2xl font-bold tabular-nums">{r.score ?? "—"}<span className="text-xs font-normal text-faint"> /100</span></p>
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
          <div className="mb-2 flex items-center gap-2">
            <h2 className="font-semibold">Lifts</h2>
            <select value={exercise} onChange={(e) => setExercise(e.target.value)} className="rounded-lg border bg-surface px-2 py-1 text-sm">
              {exercises.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
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

      {!hasDayData && liftRows.length === 0 && (
        <p className="card p-4 text-sm text-faint">Nothing shared yet — either {name} is hidden on your shared tracks or hasn&apos;t logged anything.</p>
      )}
    </div>
  );
}
