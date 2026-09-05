"use client";

/**
 * The Arena: competition boards across everyone you can see —
 * demo legends + friends from your tracks (share rules respected).
 * Most productive today / this week / all time, Upcoming DayMaxers
 * (biggest week-over-week focus-score jump), and Biggest Losers
 * (most brainrot hours this week). Names link to profiles.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchLeaderboard, type LeaderboardRow } from "@/lib/friends";
import { weekStart } from "@/lib/ranking";
import { DEFAULT_BUCKET_COLORS, loadBucketColors, type BucketColors } from "@/lib/theme";

interface Contender {
  id: string;
  name: string;
  isDemo: boolean;
  todayP: number;
  weekP: number;
  weekB: number;
  allP: number;
  allB: number;
  weekScore: number | null;
  prevWeekScore: number | null;
  improvement: number | null;
}

const MEDALS = ["🥇", "🥈", "🥉"];

function Board({
  title,
  subtitle,
  rows,
  value,
}: {
  title: string;
  subtitle: string;
  rows: Contender[];
  value: (c: Contender) => string;
}) {
  return (
    <div className="card p-4">
      <h2 className="font-semibold">{title}</h2>
      <p className="mb-2 text-xs text-muted">{subtitle}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-faint">Nobody qualifies yet.</p>
      ) : (
        <ol className="space-y-1">
          {rows.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <span className="w-6 text-center">{MEDALS[i] ?? `${i + 1}.`}</span>
              <Link href={`/friends/${c.id}`} className="font-medium hover:text-accent hover:underline">
                {c.name}
              </Link>
              {c.isDemo && <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-faint">legend</span>}
              <span className="ml-auto tabular-nums text-muted">{value(c)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function ArenaPage() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const ws = weekStart(todayISO);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [colors, setColors] = useState<BucketColors>(DEFAULT_BUCKET_COLORS);

  useEffect(() => {
    setColors(loadBucketColors());
    fetchLeaderboard()
      .then(setRows)
      .catch((e) =>
        setError(
          String(e.message ?? e).includes("does not exist") || String(e.message ?? e).includes("schema cache")
            ? "The Arena needs migration 0007 (and the demo seed) — run them in the Supabase SQL Editor."
            : String(e.message ?? e)
        )
      )
      .finally(() => setLoading(false));
  }, []);

  const contenders = useMemo<Contender[]>(() => {
    const prevWs = (() => {
      const d = new Date(ws + "T00:00:00");
      d.setDate(d.getDate() - 7);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    const byId = new Map<string, { name: string; isDemo: boolean; rows: LeaderboardRow[] }>();
    for (const r of rows) {
      if (!byId.has(r.memberId)) byId.set(r.memberId, { name: r.displayName, isDemo: r.isDemo, rows: [] });
      byId.get(r.memberId)!.rows.push(r);
    }
    const score = (list: LeaderboardRow[]) => {
      const p = list.reduce((s, r) => s + r.productive, 0);
      const b = list.reduce((s, r) => s + r.brainrot, 0);
      return p + b > 0 ? Math.round((p / (p + b)) * 1000) / 10 : null;
    };
    return [...byId.entries()].map(([id, m]) => {
      const week = m.rows.filter((r) => r.date >= ws && r.date <= todayISO);
      const prevWeek = m.rows.filter((r) => r.date >= prevWs && r.date < ws);
      const weekScore = score(week);
      const prevWeekScore = score(prevWeek);
      return {
        id,
        name: m.name,
        isDemo: m.isDemo,
        todayP: m.rows.filter((r) => r.date === todayISO).reduce((s, r) => s + r.productive, 0),
        weekP: week.reduce((s, r) => s + r.productive, 0),
        weekB: week.reduce((s, r) => s + r.brainrot, 0),
        allP: m.rows.reduce((s, r) => s + r.productive, 0),
        allB: m.rows.reduce((s, r) => s + r.brainrot, 0),
        weekScore,
        prevWeekScore,
        improvement: weekScore != null && prevWeekScore != null ? Math.round((weekScore - prevWeekScore) * 10) / 10 : null,
      };
    });
  }, [rows, todayISO, ws]);

  const top = (sel: (c: Contender) => number | null, n = 5, asc = false) =>
    contenders
      .filter((c) => sel(c) != null && sel(c) !== 0)
      .sort((a, b) => (asc ? (sel(a)! - sel(b)!) : (sel(b)! - sel(a)!)))
      .slice(0, n);

  if (loading) return <p className="text-sm text-muted">Loading the Arena…</p>;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl font-bold">The Arena</h1>
      <p className="mb-5 text-sm text-muted">
        Everyone you can see — the resident legends plus friends from your tracks. Click a name for their profile.
        Get on the boards by logging your day.
      </p>
      {error && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Board
          title="⚡ Most productive today"
          subtitle="Productive hours logged today"
          rows={top((c) => c.todayP)}
          value={(c) => `${c.todayP.toFixed(1)}h`}
        />
        <Board
          title="🔥 Most productive this week"
          subtitle="Productive hours since Monday"
          rows={top((c) => c.weekP)}
          value={(c) => `${c.weekP.toFixed(1)}h`}
        />
        <Board
          title="🏛️ All-time greats"
          subtitle="Total productive hours, ever"
          rows={top((c) => c.allP)}
          value={(c) => `${c.allP.toFixed(0)}h`}
        />
        <Board
          title="🚀 Upcoming DayMaxers"
          subtitle="Biggest focus-score jump vs last week"
          rows={top((c) => c.improvement).filter((c) => (c.improvement ?? 0) > 0)}
          value={(c) => `+${c.improvement} pts`}
        />
        <Board
          title="🧟 Biggest losers (this week)"
          subtitle="Most brainrot hours since Monday — wear it with shame"
          rows={top((c) => c.weekB)}
          value={(c) => `${c.weekB.toFixed(1)}h`}
        />
        <Board
          title="📉 All-time brainrot hall of fame"
          subtitle="Total brainrot hours, ever"
          rows={top((c) => c.allB)}
          value={(c) => `${c.allB.toFixed(0)}h`}
        />
      </div>
      <p className="mt-3 text-xs text-faint">
        Hours in <span style={{ color: colors.productive }}>productive</span> and{" "}
        <span style={{ color: colors.brainrot }}>brainrot</span> use the default buckets. Members with sharing set to
        hidden never appear.
      </p>
    </div>
  );
}
