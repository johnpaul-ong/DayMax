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
import { fetchArena, fetchTracks, type ArenaScope, type LeaderboardRow, type Track } from "@/lib/friends";
import { TeamName } from "../team-name";
import { weekStart, workMaxFrom } from "@/lib/ranking";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_BUCKET_COLORS, loadBucketColors, loadTheme, type BucketColors } from "@/lib/theme";
import { fetchTeamTotals, teamMeta, type TeamTotal } from "@/lib/teams";
import { localToday } from "@/lib/dates";

// The three standard scopes, always shown. Anything else (a track) is picked
// from the dropdown beside them.
const SCOPES: Array<{ key: ArenaScope; label: string; hint: string }> = [
  { key: "demo", label: `You vs "Avengers Assemble"`, hint: "You and the six legends" },
  { key: "friends", label: "You vs Friends", hint: "Accepted friends only — no legends, no strangers" },
  { key: "everyone", label: "Everyone", hint: "Every public profile on DayMax" },
];

interface Contender {
  id: string;
  name: string;
  isDemo: boolean;
  team: string;
  todayP: number;
  weekP: number;
  weekB: number;
  weekS: number;
  allP: number;
  allB: number;
  weekScore: number | null;
  prevWeekScore: number | null;
  improvement: number | null;
  weekWorkMax: number | null;
  allWorkMax: number | null;
}


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
      <h2 className="font-semibold">
        <Link href="/arena/compare" className="hover:text-accent hover:underline" title="See everyone's day side by side">
          {title}
        </Link>
      </h2>
      <p className="mb-2 text-xs text-muted">{subtitle}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-faint">Nobody qualifies yet.</p>
      ) : (
        <ol className="space-y-1">
          {rows.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <span className="w-6 text-center font-semibold text-faint">{i + 1}</span>
              <TeamName name={c.name} team={c.team} href={`/friends/${c.id}`} className="font-medium" />
              {c.isDemo && <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-faint">legend</span>}
              <span className="ml-auto tabular-nums text-muted">{value(c)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Light vs Midnight vs Cottage, across everyone — WorkMax averaged per member. */
function TeamBoard({ scope, trackId }: { scope: ArenaScope; trackId: string | null }) {
  const [rows, setRows] = useState<TeamTotal[]>([]);
  const [mine, setMine] = useState<string | null>(null);

  useEffect(() => {
    fetchTeamTotals(undefined, undefined, scope, trackId).then(setRows).catch(() => {});
    setMine(loadTheme().theme);
  }, [scope, trackId]);

  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.workMax), 1);

  return (
    <div className="mb-4 card p-4">
      <h2 className="font-semibold">Teams</h2>
      <p className="mb-3 text-xs text-muted">
        WorkMax averaged per member, so size doesn&apos;t win it. Your team is your theme.
      </p>
      <div className="space-y-2.5">
        {rows.map((r, i) => {
          const t = teamMeta(r.team);
          return (
            <div key={r.team} className="flex items-center gap-3">
              <span className="w-4 text-center text-xs font-bold text-faint">{i + 1}</span>
              <span className="text-lg">{t.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {t.label}
                  {r.team === mine && <span className="ml-1.5 text-xs text-accent">you</span>}
                  <span className="ml-1.5 text-xs font-normal text-faint">
                    {r.members} · {r.productive.toLocaleString()}h productive
                  </span>
                </p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${(r.workMax / max) * 100}%`, background: t.color }} />
                </div>
              </div>
              <span className="tabular-nums font-bold">{r.workMax}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ArenaPage() {
  const todayISO = localToday();
  const ws = weekStart(todayISO);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [colors, setColors] = useState<BucketColors>(DEFAULT_BUCKET_COLORS);
  const [scope, setScope] = useState<ArenaScope>("demo");
  const [trackId, setTrackId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    setColors(loadBucketColors());
    createClient().auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    fetchTracks().then(setTracks).catch(() => {});
  }, []);

  // The server does the scoping now, so switching scope refetches rather than
  // filtering a fixed set client-side — that's what made "Everyone" quietly
  // mean "everyone I already knew".
  useEffect(() => {
    setLoading(true);
    fetchArena(scope, trackId)
      .then(setRows)
      .catch((e) =>
        setError(
          String(e.message ?? e).includes("does not exist") || String(e.message ?? e).includes("schema cache")
            ? "The Arena needs migration 0031 — run it in the Supabase SQL Editor."
            : String(e.message ?? e)
        )
      )
      .finally(() => setLoading(false));
  }, [scope, trackId]);

  const contenders = useMemo<Contender[]>(() => {
    const prevWs = (() => {
      const d = new Date(ws + "T00:00:00");
      d.setDate(d.getDate() - 7);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    const byId = new Map<string, { name: string; isDemo: boolean; team: string; rows: LeaderboardRow[] }>();
    for (const r of rows) {
      if (!byId.has(r.memberId)) byId.set(r.memberId, { name: r.displayName, isDemo: r.isDemo, team: r.team, rows: [] });
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
      const weekP = week.reduce((s, r) => s + r.productive, 0);
      const weekB = week.reduce((s, r) => s + r.brainrot, 0);
      const allP = m.rows.reduce((s, r) => s + r.productive, 0);
      const allB = m.rows.reduce((s, r) => s + r.brainrot, 0);
      return {
        id,
        name: m.name,
        isDemo: m.isDemo,
        team: m.team,
        todayP: m.rows.filter((r) => r.date === todayISO).reduce((s, r) => s + r.productive, 0),
        weekP,
        weekB,
        weekS: week.reduce((s, r) => s + r.social, 0),
        allP,
        allB,
        weekScore,
        prevWeekScore,
        improvement: weekScore != null && prevWeekScore != null ? Math.round((weekScore - prevWeekScore) * 10) / 10 : null,
        weekWorkMax: workMaxFrom(weekP, weekB),
        allWorkMax: workMaxFrom(allP, allB),
      };
    });
  }, [rows, todayISO, ws]);

  // no client-side re-filtering: the scope is already applied server-side
  const scoped = contenders;

  const top = (sel: (c: Contender) => number | null, n = 5, asc = false) =>
    scoped
      .filter((c) => sel(c) != null && sel(c) !== 0)
      .sort((a, b) => (asc ? (sel(a)! - sel(b)!) : (sel(b)! - sel(a)!)))
      .slice(0, n);

  if (loading) return <p className="text-sm text-muted">Loading the Arena…</p>;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl font-bold">The Arena</h1>
      <p className="mb-5 text-sm text-muted">
        Pick who you&apos;re up against. Click a name for their profile, a
        board title to see <Link href="/arena/compare" className="font-medium text-accent hover:underline">everyone&apos;s day side by side</Link>.
        Get on the boards by logging your day.
      </p>
      {error && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>}

      <div className="mb-2 flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
        {SCOPES.map((s) => (
          <button
            key={s.key}
            onClick={() => {
              setScope(s.key);
              setTrackId(null);
            }}
            title={s.hint}
            className={`flex-1 rounded-lg px-3 py-1.5 ${scope === s.key && !trackId ? "bg-surface font-semibold" : "text-muted"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {tracks.filter((t) => !t.isDemo).length > 0 && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <span className="text-xs text-faint">or a track:</span>
          <select
            value={trackId ?? ""}
            onChange={(e) => {
              const v = e.target.value || null;
              setTrackId(v);
              setScope(v ? "track" : "everyone");
            }}
            className="rounded-lg border bg-surface px-2 py-1 text-sm"
          >
            <option value="">—</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}
      {scope === "friends" && scoped.length <= 1 && (
        <p className="mb-3 text-sm text-faint">
          No friends sharing data yet — add some from <Link href="/search" className="font-medium text-accent hover:underline">Search</Link>.
          This board is friends only, so the legends don&apos;t appear here.
        </p>
      )}

      <TeamBoard scope={scope} trackId={trackId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Board
          title="WorkMax — this week"
          subtitle="Focus score × hours put in. The one that counts."
          rows={top((c) => c.weekWorkMax)}
          value={(c) => `${c.weekWorkMax}`}
        />
        <Board
          title="WorkMax — all time"
          subtitle="Effective productive hours, ever"
          rows={top((c) => c.allWorkMax)}
          value={(c) => `${c.allWorkMax?.toFixed(0)}`}
        />
        <Board
          title="Most productive today"
          subtitle="Productive hours logged today"
          rows={top((c) => c.todayP)}
          value={(c) => `${c.todayP.toFixed(1)}h`}
        />
        <Board
          title="Most productive this week"
          subtitle="Productive hours since Monday"
          rows={top((c) => c.weekP)}
          value={(c) => `${c.weekP.toFixed(1)}h`}
        />
        <Board
          title="All-time greats"
          subtitle="Total productive hours, ever"
          rows={top((c) => c.allP)}
          value={(c) => `${c.allP.toFixed(0)}h`}
        />
        <Board
          title="Upcoming DayMaxers"
          subtitle="Biggest focus-score jump vs last week"
          rows={top((c) => c.improvement).filter((c) => (c.improvement ?? 0) > 0)}
          value={(c) => `+${c.improvement} pts`}
        />
        <Board
          title="Biggest losers (this week)"
          subtitle="Most brainrot hours since Monday — wear it with shame"
          rows={top((c) => c.weekB)}
          value={(c) => `${c.weekB.toFixed(1)}h`}
        />
        <Board
          title="Social club"
          subtitle="Most social hours this week — not part of the score, still glory"
          rows={top((c) => c.weekS)}
          value={(c) => `${c.weekS.toFixed(1)}h`}
        />
        <Board
          title="All-time brainrot hall of fame"
          subtitle="Total brainrot hours, ever"
          rows={top((c) => c.allB)}
          value={(c) => `${c.allB.toFixed(0)}h`}
        />
      </div>
      <p className="mt-3 text-xs text-faint">
        <b>WorkMax</b> = focus score ÷ 100 × productive hours — quality times quantity, so a clean 10-hour week can&apos;t
        beat a clean 40-hour one. <b>Focus score</b> = productive ÷ (productive + brainrot) × 100, quality only. Hours in{" "}
        <span style={{ color: colors.productive }}>productive</span> and{" "}
        <span style={{ color: colors.brainrot }}>brainrot</span> use the default buckets. Members with sharing set to
        hidden never appear.
      </p>
    </div>
  );
}
