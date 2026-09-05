"use client";

/**
 * Side by side. Day view: everyone's 96-slot day as columns (full detail only
 * for legends + raw-labels friends). Week/Month view: bar charts of hours per
 * person plus relative lift gains over the period — works for everyone visible,
 * because it only needs totals.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CATEGORIES, categoryColor, categoryName, slotToTime, SLOTS_PER_DAY } from "@/lib/categories";
import {
  fetchLeaderboard,
  fetchLeaderboardLifts,
  fetchMemberDayStrip,
  type DayStripRow,
  type LeaderboardLiftRow,
  type LeaderboardRow,
} from "@/lib/friends";
import { weekStart } from "@/lib/ranking";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_BUCKET_COLORS, loadBucketColors, type BucketColors } from "@/lib/theme";
import { localToday } from "@/lib/dates";

type Scope = "day" | "week" | "month";

interface PersonDays {
  id: string;
  name: string;
  isDemo: boolean;
  byDate: Map<string, Map<number, { category: number; label: string | null }>>;
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addMonths(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ArenaComparePage() {
  const todayISO = localToday();
  const [scope, setScope] = useState<Scope>("day");
  const [date, setDate] = useState(todayISO);
  const [people, setPeople] = useState<PersonDays[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [lifts, setLifts] = useState<LeaderboardLiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [colors, setColors] = useState<BucketColors>(DEFAULT_BUCKET_COLORS);
  const [roster, setRoster] = useState<Array<{ id: string; name: string; isDemo: boolean }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // which "person:YYYY-MM" windows we've already pulled from the server —
  // day-strip data is a whole year per person, so we only fetch the months
  // actually being looked at instead of everyone's entire history up front.
  const loadedMonths = useRef<Set<string>>(new Set());

  // period boundaries for the current view
  const [from, to, periodLabel] = useMemo((): [string, string, string] => {
    if (scope === "day") return [date, date, date];
    if (scope === "week") {
      const ws = weekStart(date);
      return [ws, addDays(ws, 6), `week of ${ws}`];
    }
    const m = date.slice(0, 7);
    const [y, mo] = m.split("-").map(Number);
    return [`${m}-01`, `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`, m];
  }, [scope, date]);

  // Padding means normal back/forward navigation usually stays inside what's
  // already loaded and cached, so it doesn't refetch on every click.
  const [windowFrom, windowTo] = useMemo(() => [addDays(from, -45), addDays(to, 45)], [from, to]);

  useEffect(() => {
    setColors(loadBucketColors());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await createClient().auth.getUser();
        const me = data.user?.id ?? null;
        // this page never shows more than one month at a time, so ask for a
        // padded window rather than everyone's entire history
        const rows = await fetchLeaderboard(windowFrom, windowTo);
        if (cancelled) return;
        setBoard(rows);
        fetchLeaderboardLifts(windowFrom, windowTo)
          .then((l) => !cancelled && setLifts(l))
          .catch(() => {});
        const ids = new Map<string, { name: string; isDemo: boolean }>();
        for (const r of rows) ids.set(r.memberId, { name: r.displayName, isDemo: r.isDemo });
        if (me && !ids.has(me)) ids.set(me, { name: "You", isDemo: false });
        const ros = [...ids.entries()]
          .map(([id, info]) => ({ id, name: id === me ? `${info.name} (you)` : info.name, isDemo: info.isDemo }))
          .sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name)))
          .slice(0, 10);
        setRoster(ros);
        // keep whatever the user toggled; default to everyone on first load
        setSelected((prev) => (prev.size === 0 ? new Set(ros.map((r) => r.id)) : prev));
        setPeople((prev) =>
          ros.map((r) => prev.find((p) => p.id === r.id) ?? { id: r.id, name: r.name, isDemo: r.isDemo, byDate: new Map() })
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [windowFrom, windowTo]);

  // Fetch just the month containing the selected date, per person, the first
  // time it's needed — not the whole year for everyone on every page load.
  useEffect(() => {
    if (scope !== "day" || roster.length === 0) return;
    const month = date.slice(0, 7);
    const [y, mo] = month.split("-").map(Number);
    const monthFrom = `${month}-01`;
    const monthTo = `${month}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`;
    const todo = roster.filter((r) => !loadedMonths.current.has(`${r.id}:${month}`));
    if (todo.length === 0) return;
    const noAccess: string[] = [];
    Promise.all(
      todo.map(async (r) => {
        loadedMonths.current.add(`${r.id}:${month}`);
        try {
          const strip: DayStripRow[] = await fetchMemberDayStrip(r.id, monthFrom, monthTo);
          setPeople((prev) =>
            prev.map((p) => {
              if (p.id !== r.id) return p;
              const byDate = new Map(p.byDate);
              for (const row of strip) {
                if (!byDate.has(row.date)) byDate.set(row.date, new Map());
                byDate.get(row.date)!.set(row.slot, { category: row.category, label: row.label });
              }
              return { ...p, byDate };
            })
          );
        } catch {
          noAccess.push(r.name);
        }
      })
    ).then(() => {
      if (noAccess.length) setSkipped((prev) => [...new Set([...prev, ...noAccess])]);
    });
  }, [scope, date, roster]);

  function shift(dir: 1 | -1) {
    if (scope === "day") setDate(addDays(date, dir));
    else if (scope === "week") setDate(addDays(date, 7 * dir));
    else setDate(addMonths(date, dir));
  }

  const dayColumns = useMemo(
    () => people.filter((p) => selected.has(p.id)).map((p) => ({ ...p, day: p.byDate.get(date) ?? null })).filter((p) => p.day !== null || p.isDemo),
    [people, date, selected]
  );

  // week/month: hours per person from leaderboard totals (works for everyone)
  const periodBars = useMemo(() => {
    const byId = new Map<string, { name: string; productive: number; brainrot: number; social: number; other: number }>();
    for (const r of board) {
      if (r.date < from || r.date > to || !selected.has(r.memberId)) continue;
      const cur = byId.get(r.memberId) ?? { name: r.displayName, productive: 0, brainrot: 0, social: 0, other: 0 };
      cur.productive += r.productive;
      cur.brainrot += r.brainrot;
      cur.social += r.social;
      cur.other += r.other;
      byId.set(r.memberId, cur);
    }
    return Array.from(byId.values()).sort((a, b) => b.productive - a.productive);
  }, [board, from, to, selected]);

  // relative lift gains inside the period: avg % change across exercises with 2+ sessions
  const liftGains = useMemo(() => {
    const byPerson = new Map<string, { name: string; byExercise: Map<string, Array<[string, number]>> }>();
    for (const l of lifts) {
      if (l.date < from || l.date > to || !selected.has(l.memberId)) continue;
      if (!byPerson.has(l.memberId)) byPerson.set(l.memberId, { name: l.displayName, byExercise: new Map() });
      const p = byPerson.get(l.memberId)!;
      p.byExercise.set(l.exercise, [...(p.byExercise.get(l.exercise) ?? []), [l.date, l.weightKg]]);
    }
    const out: Array<{ name: string; gain: number; exercises: number }> = [];
    for (const { name, byExercise } of byPerson.values()) {
      const gains: number[] = [];
      for (const pts of byExercise.values()) {
        if (pts.length < 2) continue;
        pts.sort(([a], [b]) => (a < b ? -1 : 1));
        const first = pts[0][1];
        const last = pts[pts.length - 1][1];
        if (first > 0) gains.push(((last - first) / first) * 100);
      }
      if (gains.length) out.push({ name, gain: Math.round((gains.reduce((s, g) => s + g, 0) / gains.length) * 10) / 10, exercises: gains.length });
    }
    return out.sort((a, b) => b.gain - a.gain);
  }, [lifts, from, to, selected]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">Side by side</h1>
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
          {(["day", "week", "month"] as const).map((s) => (
            <button key={s} onClick={() => setScope(s)} className={`rounded-lg px-3 py-1 capitalize ${scope === s ? "bg-surface font-semibold" : "text-muted"}`}>
              {s}
            </button>
          ))}
        </div>
        <button onClick={() => shift(-1)} className="rounded-lg border px-2.5 py-1 text-sm">←</button>
        {scope === "month" ? (
          <input type="month" value={date.slice(0, 7)} onChange={(e) => e.target.value && setDate(`${e.target.value}-01`)} className="rounded-lg border bg-surface px-2 py-1 text-sm" />
        ) : (
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="rounded-lg border bg-surface px-2 py-1 text-sm" />
        )}
        {scope !== "day" && <span className="text-xs tabular-nums text-faint">{periodLabel}</span>}
        <button onClick={() => shift(1)} disabled={from >= todayISO} className="rounded-lg border px-2.5 py-1 text-sm disabled:opacity-40">→</button>
        <Link href="/arena" className="ml-auto text-sm font-medium text-accent hover:underline">← Arena</Link>
      </div>

      {roster.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button onClick={() => setSelected(new Set(roster.map((r) => r.id)))} className="rounded-full border px-2.5 py-1 text-xs text-muted hover:text-ink">Everyone</button>
          <button onClick={() => setSelected(new Set(roster.filter((r) => r.isDemo || r.name.endsWith("(you)")).map((r) => r.id)))} className="rounded-full border px-2.5 py-1 text-xs text-muted hover:text-ink">&quot;Avengers Assemble&quot;</button>
          <button onClick={() => setSelected(new Set(roster.filter((r) => !r.isDemo).map((r) => r.id)))} className="rounded-full border px-2.5 py-1 text-xs text-muted hover:text-ink">Friends</button>
          <span className="mx-1 text-faint">·</span>
          {roster.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                const next = new Set(selected);
                if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                setSelected(next);
              }}
              className={`rounded-full border px-2.5 py-1 text-xs ${selected.has(r.id) ? "bg-accent-soft font-semibold text-accent" : "text-faint line-through"}`}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-muted">Loading…</p>
      ) : scope === "day" ? (
        <>
          <p className="mb-3 text-sm text-muted">
            Whole days, hover any block for the activity. Full detail shows for people who share it
            {skipped.length > 0 && <> — {skipped.join(", ")} share totals only (switch to week/month to include them)</>}.
          </p>
          <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {CATEGORIES.map((c) => (
              <span key={c.code} className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />
                {c.name}
              </span>
            ))}
          </div>
          {dayColumns.length === 0 ? (
            <p className="card p-4 text-sm text-faint">Nothing to show for {date}.</p>
          ) : (
            <div className="card overflow-x-auto p-4">
              <div className="flex gap-6">
                <div className="relative w-10 shrink-0" style={{ height: 576 }}>
                  {[0, 6, 12, 18, 24].map((h) => (
                    <span key={h} className="absolute right-0 -translate-y-1/2 font-mono text-[10px] text-faint" style={{ top: (h / 24) * 576 }}>
                      {String(h).padStart(2, "0")}:00
                    </span>
                  ))}
                </div>
                {dayColumns.map((p) => (
                  <div key={p.id} className="flex w-28 shrink-0 flex-col items-center">
                    <Link href={`/friends/${p.id}`} className="mb-2 max-w-full truncate text-sm font-semibold hover:text-accent hover:underline">
                      {p.name}
                    </Link>
                    <div className="flex w-full flex-col overflow-hidden rounded-lg border" style={{ height: 576 }}>
                      {Array.from({ length: SLOTS_PER_DAY }, (_, s) => {
                        const c = p.day?.get(s);
                        return (
                          <div
                            key={s}
                            title={`${p.name} — ${slotToTime(s)}${c ? `: ${categoryName(c.category)}${c.label ? ` (${c.label})` : ""}` : ""}`}
                            className="w-full flex-1 overflow-hidden whitespace-nowrap"
                            style={{ background: c ? categoryColor(c.category) : "var(--surface-2)" }}
                          >
                            {c?.label && s % 4 === 0 ? (
                              <span className="block truncate px-1 text-[8px] font-medium leading-[6px] text-white/90">{c.label}</span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    <span className="mt-1 text-[10px] text-faint">{p.day ? `${p.day.size}/96 logged` : "nothing logged"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">Hours per person over the {scope} — includes everyone visible, even totals-only friends.</p>
          {periodBars.length === 0 ? (
            <p className="card p-4 text-sm text-faint">No data in this {scope}.</p>
          ) : (
            <div className="h-80 card p-2">
              <ResponsiveContainer>
                <BarChart data={periodBars}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} unit="h" />
                  <Tooltip formatter={(v: number) => `${Number(v).toFixed(1)}h`} />
                  <Legend />
                  <Bar dataKey="productive" fill={colors.productive} />
                  <Bar dataKey="brainrot" fill={colors.brainrot} />
                  <Bar dataKey="other" fill={colors.other} />
                  <Bar dataKey="social" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <h2 className="mb-1 mt-6 font-semibold">Lift gains this {scope} <span className="text-sm font-normal text-muted">(relative, % change first → last session)</span></h2>
          {liftGains.length === 0 ? (
            <p className="card p-4 text-sm text-faint">Nobody logged the same lift twice in this {scope}.</p>
          ) : (
            <div className="h-64 card p-2">
              <ResponsiveContainer>
                <BarChart data={liftGains}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip formatter={(v: number, _n: string, item: any) => [`${v}% across ${item?.payload?.exercises} lift(s)`, "gain"]} />
                  <Bar dataKey="gain" fill="var(--accent)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
