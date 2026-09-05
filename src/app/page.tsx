"use client";

/**
 * Home: the daily scoreboard. Today's and this week's productive/brainrot
 * hours, how much of today is logged, and your latest lifts — at a glance.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { categoryColor, categoryName } from "@/lib/categories";
import { fetchBucketSettings, fetchDayEntries, fetchLifts, fetchProfile } from "@/lib/data";
import { lifeStats, type LifeStats } from "@/lib/life";
import { bucketize, focusScore, hoursByCategory, weekStart } from "@/lib/ranking";
import { DEFAULT_BUCKET_COLORS, loadBucketColors, type BucketColors } from "@/lib/theme";
import type { BucketSettings, DayEntry, LiftEntry } from "@/lib/types";
import SignOutButton from "./signout-button";

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="card flex-1 p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-faint">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums" style={color ? { color } : undefined}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function LifeCard({ life, country }: { life: LifeStats; country: string | null }) {
  const totalWeeks = Math.round(life.expectancy * 52.18);
  const livedWeeks = Math.min(totalWeeks, Math.round(life.ageYears * 52.18));
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-muted">Your life</h2>
        <span className="text-xs text-faint">
          life expectancy {life.expectancy.toFixed(1)}y{country ? ` (${country})` : " (world avg)"}
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-6">
        <div>
          <p className="text-3xl font-bold tabular-nums">{life.percentLived.toFixed(1)}%</p>
          <p className="text-xs text-muted">lived</p>
        </div>
        <div>
          <p className="text-3xl font-bold tabular-nums">{life.ageYears.toFixed(1)}</p>
          <p className="text-xs text-muted">years old</p>
        </div>
        <div>
          <p className="text-3xl font-bold tabular-nums">{life.yearsLeft.toFixed(1)}</p>
          <p className="text-xs text-muted">years left</p>
        </div>
        <div>
          <p className="text-3xl font-bold tabular-nums">{Math.round(life.weeksLeft).toLocaleString()}</p>
          <p className="text-xs text-muted">weeks left</p>
        </div>
      </div>

      <div className="mb-3 h-3 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${life.percentLived}%` }} />
      </div>

      {/* your life in weeks: one dot per week, one row per year */}
      <div
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: "repeat(52, minmax(0, 1fr))" }}
        title={`${livedWeeks.toLocaleString()} of ${totalWeeks.toLocaleString()} expected weeks lived`}
      >
        {Array.from({ length: totalWeeks }, (_, i) => (
          <div
            key={i}
            className="aspect-square w-full rounded-[1px]"
            style={{ background: i < livedWeeks ? "var(--accent)" : "var(--surface-2)", opacity: i < livedWeeks ? 0.85 : 1 }}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-faint">
        Every square is one week. Each row is a year. The gray ones are all you have — make the slots count.
      </p>
    </div>
  );
}

export default function HomePage() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const ws = weekStart(todayISO);
  const [weekEntries, setWeekEntries] = useState<DayEntry[]>([]);
  const [lifts, setLifts] = useState<Array<LiftEntry & { id: number }>>([]);
  const [settings, setSettings] = useState<BucketSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [life, setLife] = useState<LifeStats | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [colors, setColors] = useState<BucketColors>(DEFAULT_BUCKET_COLORS);

  useEffect(() => {
    setColors(loadBucketColors());
    Promise.all([fetchDayEntries(ws, todayISO), fetchLifts(), fetchBucketSettings()])
      .then(([e, l, s]) => {
        setWeekEntries(e);
        setLifts(l);
        setSettings(s);
      })
      .finally(() => setLoading(false));
    fetchProfile()
      .then((p) => {
        if (p.birthDate) {
          setLife(lifeStats(p.birthDate, p.country));
          setCountry(p.country);
        }
      })
      .catch(() => {}); // before migration 0002, quietly skip
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const todayEntries = useMemo(() => weekEntries.filter((e) => e.date === todayISO), [weekEntries, todayISO]);
  const todayTotals = useMemo(() => (settings ? bucketize(hoursByCategory(todayEntries), settings) : null), [todayEntries, settings]);
  const weekTotals = useMemo(() => (settings ? bucketize(hoursByCategory(weekEntries), settings) : null), [weekEntries, settings]);

  const todayTopCats = useMemo(() => {
    const h = hoursByCategory(todayEntries);
    return Object.entries(h)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4)
      .map(([code, hours]) => ({ code: Number(code), hours }));
  }, [todayEntries]);

  const recentLifts = lifts.slice(0, 5);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          </h1>
          <p className="text-sm text-muted">{todayEntries.length}/96 slots logged today</p>
        </div>
        <div className="flex gap-2">
          <Link href="/today" className="btn-primary">Log now</Link>
          <SignOutButton />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading your day…</p>
      ) : (
        <>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-muted">Today</h2>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Stat label="Productive" value={`${(todayTotals?.productive ?? 0).toFixed(1)}h`} color={colors.productive} />
              <Stat label="Brainrot" value={`${(todayTotals?.brainrot ?? 0).toFixed(1)}h`} color={colors.brainrot} />
              <Stat
                label="Focus score"
                value={todayTotals && focusScore(todayTotals) !== null ? `${focusScore(todayTotals)}` : "—"}
                sub="productive ÷ (productive + brainrot) × 100"
              />
            </div>
            {todayTopCats.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {todayTopCats.map((c) => (
                  <span key={c.code} className="inline-flex items-center gap-1.5 rounded-full border bg-surface px-3 py-1 text-xs font-medium">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: categoryColor(c.code) }} />
                    {categoryName(c.code)} · {c.hours.toFixed(1)}h
                  </span>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-muted">This week (from {ws.slice(5)})</h2>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Stat label="Productive" value={`${(weekTotals?.productive ?? 0).toFixed(1)}h`} color={colors.productive} />
              <Stat label="Brainrot" value={`${(weekTotals?.brainrot ?? 0).toFixed(1)}h`} color={colors.brainrot} />
              <Stat
                label="Focus score"
                value={weekTotals && focusScore(weekTotals) !== null ? `${focusScore(weekTotals)}` : "—"}
                sub="productive ÷ (productive + brainrot) × 100"
              />
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted">Recent lifts</h2>
              <Link href="/lifts" className="text-sm font-medium text-accent hover:underline">All lifts →</Link>
            </div>
            {recentLifts.length === 0 ? (
              <p className="card p-4 text-sm text-muted">No lifts logged yet.</p>
            ) : (
              <div className="card divide-y overflow-hidden">
                {recentLifts.map((l) => (
                  <div key={l.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="w-24 shrink-0 tabular-nums text-faint">{l.date}</span>
                    <span className="font-medium">{l.exercise}</span>
                    <span className="ml-auto tabular-nums text-muted">
                      {l.weightKg != null ? `${l.weightKg}kg` : ""} {l.reps ? `× ${l.reps}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {life && <LifeCard life={life} country={country} />}

          <section className="grid gap-3 sm:grid-cols-3">
            {[
              { href: "/day", title: "Day grid", desc: "The Excel-killer. Drag, type, done." },
              { href: "/year", title: "Year view", desc: "Every day of the year at a glance." },
              { href: "/overview", title: "Overview", desc: "Rankings, graphs, raw data." },
            ].map((c) => (
              <Link key={c.href} href={c.href} className="card p-4 transition hover:-translate-y-0.5">
                <h3 className="font-semibold">{c.title}</h3>
                <p className="mt-1 text-sm text-muted">{c.desc}</p>
              </Link>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
