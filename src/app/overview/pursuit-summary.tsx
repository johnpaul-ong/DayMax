"use client";

/**
 * How am I doing at everything?
 *
 * Nothing in the app answered that. Analytics had eleven charts about Life and
 * nothing about the other pursuits; the pursuit pages each answered for
 * themselves. One card per pursuit: the headline number, which way it is
 * moving, where you sit among the members, and a sparkline.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { localToday } from "@/lib/dates";
import { fetchDirectory, fetchMyEntries, fetchStats, fetchStatTop, pursuitHref, type Pursuit } from "@/lib/pursuits";

interface Card {
  id: string;
  name: string;
  headline: string;
  unit: string;
  sub: string;
  /** percent change, recent half vs the half before it */
  trend: number | null;
  rank: number | null;
  of: number;
  points: Array<{ v: number }>;
}

/** Split a series in half and compare the halves. Enough to say "up" or "down". */
function trendOf(values: number[]): number | null {
  if (values.length < 6) return null;
  const mid = Math.floor(values.length / 2);
  const a = values.slice(0, mid);
  const b = values.slice(mid);
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const before = avg(a);
  if (before === 0) return null;
  return Math.round(((avg(b) - before) / Math.abs(before)) * 100);
}

export default function PursuitSummary() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const dir = await fetchDirectory();
        const mine = dir.filter((p) => p.isMember);
        const out = await Promise.all(mine.map((p) => cardFor(p)));
        setCards(out.filter(Boolean) as Card[]);
      } catch (e: any) {
        setError(String(e.message ?? e));
      }
    })();
  }, []);

  if (error) return <p className="mb-6 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>;
  if (!cards) return <p className="mb-6 text-sm text-muted">Reading your pursuits…</p>;
  if (cards.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-1 font-semibold">Every pursuit you&apos;re in</h2>
      <p className="mb-3 text-sm text-muted">
        One line each. The arrow compares your recent half against the half before it.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <Link key={c.id} href={pursuitHref({ id: c.id, kind: "custom" })} className="card p-4 transition hover:-translate-y-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-semibold">{c.name}</h3>
              {c.rank != null && (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted">
                  #{c.rank} of {c.of}
                </span>
              )}
            </div>
            <div className="mt-1 flex items-end gap-2">
              <p className="text-2xl font-bold tabular-nums">{c.headline}</p>
              <p className="pb-1 text-xs text-faint">{c.unit}</p>
              {c.trend != null && c.trend !== 0 && (
                <p className={`pb-1 text-xs font-semibold ${c.trend > 0 ? "text-ok" : "text-danger"}`}>
                  {c.trend > 0 ? "▲" : "▼"} {Math.abs(c.trend)}%
                </p>
              )}
            </div>
            <p className="text-xs text-muted">{c.sub}</p>
            {c.points.length > 2 && (
              <div className="mt-2 h-10">
                <ResponsiveContainer>
                  <LineChart data={c.points}>
                    <Line type="monotone" dataKey="v" stroke="var(--accent)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}

async function cardFor(p: Pursuit): Promise<Card | null> {
  // Life and Lifts have their own shapes; everything else is stat-driven.
  if (p.kind === "life") return lifeCard(p);
  if (p.kind === "lifts") return liftsCard(p);
  return statCard(p);
}

async function lifeCard(p: Pursuit): Promise<Card | null> {
  const { fetchDayEntries } = await import("@/lib/data");
  const { defaultBuckets, HOURS_PER_SLOT } = await import("@/lib/categories");
  const { workMaxFrom } = await import("@/lib/ranking");
  const from = new Date();
  from.setDate(from.getDate() - 27);
  const es = await fetchDayEntries(localToday(from), localToday()).catch(() => []);
  if (es.length === 0) return null;
  const b = defaultBuckets();
  const byDate = new Map<string, { p: number; br: number }>();
  for (const e of es) {
    const cur = byDate.get(e.date) ?? { p: 0, br: 0 };
    const k = b[e.category];
    if (k === "productive") cur.p += HOURS_PER_SLOT;
    else if (k === "brainrot") cur.br += HOURS_PER_SLOT;
    byDate.set(e.date, cur);
  }
  const days = [...byDate.entries()].sort();
  const wm = days.map(([, v]) => workMaxFrom(v.p, v.br) ?? 0);
  const tot = days.reduce((s, [, v]) => s + v.p, 0);
  return {
    id: p.id,
    name: p.name,
    headline: (tot / days.length).toFixed(1),
    unit: "productive h/day",
    sub: `${days.length} days logged · WorkMax ${(wm.reduce((s, x) => s + x, 0) / wm.length).toFixed(1)} avg`,
    trend: trendOf(wm),
    rank: null,
    of: p.memberCount,
    points: wm.map((v) => ({ v })),
  };
}

async function liftsCard(p: Pursuit): Promise<Card | null> {
  const { fetchLifts } = await import("@/lib/data");
  const ls = await fetchLifts().catch(() => []);
  if (ls.length === 0) return null;
  const counts = new Map<string, number>();
  for (const l of ls) counts.set(l.exercise, (counts.get(l.exercise) ?? 0) + 1);
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const series = ls
    .filter((l) => l.exercise === main && l.weightKg != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((l) => Number(l.weightKg));
  return {
    id: p.id,
    name: p.name,
    headline: series.length ? String(Math.max(...series)) : "—",
    unit: `kg best · ${main}`,
    sub: `${ls.length} sessions · ${counts.size} exercises`,
    trend: trendOf(series),
    rank: null,
    of: p.memberCount,
    points: series.map((v) => ({ v })),
  };
}

async function statCard(p: Pursuit): Promise<Card | null> {
  const stats = await fetchStats(p.id).catch(() => []);
  const first = stats.find((s) => !s.hidden);
  if (!first) return null;
  const mine = await fetchMyEntries(first.id).catch(() => []);
  if (mine.length === 0) return null;
  const series = [...mine].sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => e.value);

  let rank: number | null = null;
  try {
    const { createClient } = await import("@/lib/supabase/client");
    const { data } = await createClient().auth.getUser();
    const top = await fetchStatTop(first.id, 50);
    const i = top.findIndex((t) => t.memberId === data.user?.id);
    if (i >= 0) rank = i + 1;
  } catch {}

  const latest = series[series.length - 1];
  const total = series.reduce((s, x) => s + x, 0);
  const daily = first.cadence === "daily";
  const t = trendOf(series);
  return {
    id: p.id,
    name: p.name,
    headline: daily ? Math.round(total).toLocaleString() : String(latest),
    unit: daily ? `${first.unit} total` : first.unit,
    sub: `${mine.length} entries · ${first.name}`,
    // for a "less is better" stat, a fall is an improvement
    trend: t == null ? null : first.direction === "less" ? -t : t,
    rank,
    of: p.memberCount,
    points: series.map((v) => ({ v })),
  };
}
