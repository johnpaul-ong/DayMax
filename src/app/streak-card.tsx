"use client";

/**
 * Today's completion, your streak, and what the data says about you.
 *
 * The three things a returning user should see in the first two seconds:
 * am I on track today, am I keeping this up, and did any of this mean anything.
 */

import { useEffect, useState } from "react";
import { fetchAllDayEntries, fetchDayMetrics } from "@/lib/data";
import { localToday } from "@/lib/dates";
import { completionByDate, DAY_COMPLETE_SLOTS, streakMessage, summarise, type StreakSummary } from "@/lib/streaks";
import { buildInsights, factsFromTotals, type Insight } from "@/lib/insights";
import { bucketize, hoursByCategory } from "@/lib/ranking";
import { defaultBuckets, SLOTS_PER_DAY } from "@/lib/categories";
import type { DayEntry } from "@/lib/types";

function Ring({ percent, label }: { percent: number; label: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-[68px] w-[68px] shrink-0">
      <svg viewBox="0 0 68 68" className="h-full w-full -rotate-90">
        <circle cx="34" cy="34" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="7" />
        <circle
          cx="34"
          cy="34"
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, percent / 100))}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums">{label}</span>
    </div>
  );
}

export default function StreakCard() {
  const [streak, setStreak] = useState<StreakSummary | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const todayISO = localToday();

  useEffect(() => {
    (async () => {
      try {
        const entries: DayEntry[] = await fetchAllDayEntries();
        const byDate = completionByDate(entries);
        setStreak(summarise(byDate, todayISO));

        // day totals for the insight generators
        const perDay = new Map<string, DayEntry[]>();
        for (const e of entries) perDay.set(e.date, [...(perDay.get(e.date) ?? []), e]);
        const buckets = defaultBuckets();
        const totals = [...perDay.entries()].map(([date, es]) => {
          const t = bucketize(hoursByCategory(es), buckets);
          const social = es.filter((e) => e.category === 3).length * 0.25;
          return { date, productive: t.productive, brainrot: t.brainrot, social, other: t.other };
        });

        let metrics: Array<{ date: string; emotionalScore: number | null; tired: number | null }> = [];
        try {
          const from = totals.length ? totals.map((t) => t.date).sort()[0] : todayISO;
          metrics = (await fetchDayMetrics(from, todayISO)).map((m) => ({
            date: m.date,
            emotionalScore: m.emotionalScore,
            tired: m.tired,
          }));
        } catch {
          // metrics are optional; insights degrade gracefully without them
        }
        setInsights(buildInsights(factsFromTotals(totals, metrics), todayISO));
      } catch {
        // signed out or offline — render nothing rather than an error box
      }
    })();
  }, [todayISO]);

  if (!streak) return null;
  const msg = streakMessage(streak);
  const remaining = Math.max(0, DAY_COMPLETE_SLOTS - streak.todaySlots);

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center gap-4">
        <Ring percent={streak.todayPercent} label={`${streak.todayPercent}%`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {streak.todaySlots}/{SLOTS_PER_DAY} slots logged today
          </p>
          <p className="text-sm text-muted">
            {remaining > 0
              ? `${remaining} more and today counts as complete.`
              : "Today counts. Nicely done."}
          </p>
          {msg && <p className="mt-0.5 text-xs text-faint">{msg}</p>}
        </div>
        <div className="flex gap-5">
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums">{streak.current}</p>
            <p className="text-[10px] uppercase tracking-wide text-faint">streak</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums">{streak.longest}</p>
            <p className="text-[10px] uppercase tracking-wide text-faint">best</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums">{streak.last30}</p>
            <p className="text-[10px] uppercase tracking-wide text-faint">of 30</p>
          </div>
        </div>
      </div>

      {insights.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">What your data says</p>
          <ul className="space-y-2">
            {insights.map((i) => (
              <li key={i.text} className="text-sm">
                {i.text}
                <span className="ml-1.5 text-xs text-faint">({i.basis})</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-faint">
            Patterns in your own logs, not advice — correlation only, and never shown on thin data.
          </p>
        </div>
      )}
    </section>
  );
}
