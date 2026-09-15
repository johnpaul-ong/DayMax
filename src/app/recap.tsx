"use client";

/**
 * Two cards that compare you to yourself.
 *
 * Everything competitive in DayMax measures you against other people. Neither
 * of these does: one asks what this week looked like next to your own normal,
 * the other asks what you were doing on this date a month and a year ago.
 * Both are questions the data could always answer and nothing was asking.
 */

import { useEffect, useMemo, useState } from "react";
import { categoryColor, categoryName, defaultBuckets, HOURS_PER_SLOT } from "@/lib/categories";
import { fetchAllDayEntries } from "@/lib/data";
import { localToday } from "@/lib/dates";
import type { DayEntry } from "@/lib/types";

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localToday(d);
}

/** Same day-of-month, n months back. Clamps so 31 Mar - 1 month is 28/29 Feb, not 3 Mar. */
function monthsBack(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return localToday(d);
}

export default function Recap() {
  const [entries, setEntries] = useState<DayEntry[] | null>(null);
  useEffect(() => {
    fetchAllDayEntries().then(setEntries).catch(() => setEntries([]));
  }, []);
  if (!entries || entries.length === 0) return null;
  return (
    <>
      <WeekRecap entries={entries} />
      <OnThisDay entries={entries} />
    </>
  );
}

/** This week against your own average week. Not a leaderboard. */
function WeekRecap({ entries }: { entries: DayEntry[] }) {
  const r = useMemo(() => {
    const today = localToday();
    const weekAgo = addDays(today, -6);
    const buckets = defaultBuckets();

    const perDay = new Map<string, { p: number; b: number; cats: Map<number, number> }>();
    for (const e of entries) {
      const cur = perDay.get(e.date) ?? { p: 0, b: 0, cats: new Map() };
      const k = buckets[e.category];
      if (k === "productive") cur.p += HOURS_PER_SLOT;
      else if (k === "brainrot") cur.b += HOURS_PER_SLOT;
      cur.cats.set(e.category, (cur.cats.get(e.category) ?? 0) + HOURS_PER_SLOT);
      perDay.set(e.date, cur);
    }

    const week = [...perDay.entries()].filter(([d]) => d >= weekAgo && d <= today);
    const before = [...perDay.entries()].filter(([d]) => d < weekAgo);
    if (week.length === 0 || before.length < 14) return null;

    const avg = (rows: typeof week, pick: (v: (typeof week)[0][1]) => number) =>
      rows.reduce((s, [, v]) => s + pick(v), 0) / rows.length;

    const nowP = avg(week, (v) => v.p);
    const wasP = avg(before, (v) => v.p);
    const nowB = avg(week, (v) => v.b);
    const wasB = avg(before, (v) => v.b);

    // the category that moved most, in hours a day
    const catAvg = (rows: typeof week) => {
      const m = new Map<number, number>();
      for (const [, v] of rows) for (const [c, h] of v.cats) m.set(c, (m.get(c) ?? 0) + h);
      for (const [c, h] of m) m.set(c, h / rows.length);
      return m;
    };
    const a = catAvg(week);
    const b = catAvg(before);
    let moved: { cat: number; delta: number } | null = null;
    for (const c of new Set([...a.keys(), ...b.keys()])) {
      const delta = (a.get(c) ?? 0) - (b.get(c) ?? 0);
      if (!moved || Math.abs(delta) > Math.abs(moved.delta)) moved = { cat: c, delta };
    }
    return { days: week.length, nowP, wasP, nowB, wasB, moved };
  }, [entries]);

  if (!r) return null;
  const dP = r.nowP - r.wasP;
  const dB = r.nowB - r.wasB;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-muted">Your week vs your normal</h2>
      <div className="card p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Delta label="Productive" now={r.nowP} delta={dP} good="up" />
          <Delta label="Brainrot" now={r.nowB} delta={dB} good="down" />
          {r.moved && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-faint">Biggest change</p>
              <p className="mt-1 flex items-baseline gap-1.5 text-2xl font-bold tabular-nums">
                <span className="h-3 w-3 rounded-sm" style={{ background: categoryColor(r.moved.cat) }} />
                {r.moved.delta > 0 ? "+" : ""}
                {r.moved.delta.toFixed(1)}h
              </p>
              <p className="text-xs text-muted">{categoryName(r.moved.cat)} a day</p>
            </div>
          )}
        </div>
        <p className="mt-3 border-t pt-2 text-sm text-muted">
          {Math.abs(dP) < 0.25 && Math.abs(dB) < 0.25 ? (
            <>A completely typical week — nothing moved more than 15 minutes a day.</>
          ) : (
            <>
              Over {r.days} day{r.days === 1 ? "" : "s"} you averaged <b>{r.nowP.toFixed(1)}h</b> productive
              {Math.abs(dP) >= 0.25 && (
                <>
                  , {dP > 0 ? "up" : "down"} {Math.abs(dP).toFixed(1)}h on your usual {r.wasP.toFixed(1)}h
                </>
              )}
              . {dB > 0.25 && <>Brainrot is up {dB.toFixed(1)}h a day too.</>}
              {dB < -0.25 && <>Brainrot is down {Math.abs(dB).toFixed(1)}h a day.</>}
            </>
          )}
        </p>
      </div>
    </section>
  );
}

function Delta({ label, now, delta, good }: { label: string; now: number; delta: number; good: "up" | "down" }) {
  const better = good === "up" ? delta > 0 : delta < 0;
  const flat = Math.abs(delta) < 0.05;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-faint">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{now.toFixed(1)}h</p>
      <p className={`text-xs font-semibold ${flat ? "text-faint" : better ? "text-ok" : "text-danger"}`}>
        {flat ? "no change" : `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}h vs normal`}
      </p>
    </div>
  );
}

/** What you were doing on this date before. */
function OnThisDay({ entries }: { entries: DayEntry[] }) {
  const today = localToday();
  const past = useMemo(() => {
    const byDate = new Map<string, DayEntry[]>();
    for (const e of entries) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date)!.push(e);
    }
    const want = [
      { label: "a month ago", date: monthsBack(today, 1) },
      { label: "three months ago", date: monthsBack(today, 3) },
      { label: "six months ago", date: monthsBack(today, 6) },
      { label: "a year ago", date: monthsBack(today, 12) },
    ];
    return want
      .map((w) => {
        const rows = byDate.get(w.date);
        if (!rows || rows.length < 16) return null; // less than 4h logged: not a day
        const cats = new Map<number, number>();
        for (const e of rows) cats.set(e.category, (cats.get(e.category) ?? 0) + HOURS_PER_SLOT);
        const top = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        // the labels you wrote that day, most used first — this is the memory
        const words = new Map<string, number>();
        for (const e of rows) if (e.label) words.set(e.label, (words.get(e.label) ?? 0) + 1);
        return {
          ...w,
          slots: rows.length,
          top,
          words: [...words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w2]) => w2),
        };
      })
      .filter(Boolean) as Array<{ label: string; date: string; slots: number; top: Array<[number, number]>; words: string[] }>;
  }, [entries, today]);

  if (past.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-muted">On this day</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {past.map((p) => (
          <div key={p.date} className="card p-4">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-faint">{p.label}</p>
              <p className="text-xs text-faint">{p.date}</p>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.top.map(([cat, h]) => (
                <span key={cat} className="inline-flex items-center gap-1.5 rounded-full border bg-surface px-2.5 py-1 text-xs font-medium">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: categoryColor(cat) }} />
                  {categoryName(cat)} · {h.toFixed(1)}h
                </span>
              ))}
            </div>
            {p.words.length > 0 && (
              <p className="mt-2 text-sm text-muted">{p.words.join(" · ")}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
