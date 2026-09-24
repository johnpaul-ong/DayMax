"use client";

/**
 * Pursuit overview — averages across ALL members of a chess pursuit who
 * have set a chess.com username in their `pursuit_members.config.chess`.
 *
 * Reads ONLY. Never triggers a Lichess analysis for anyone else's games:
 * accuracy metrics come from each member's OWN cached analyses (which they
 * generated on their "My data" tab). If nobody has cached anything, the
 * accuracy column just shows "—".
 *
 * Fetches the same 3-month chess.com window as the individual view — heavy
 * users can hit "Load more" on their own tab, but the cross-member overview
 * stays compact.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartSeries } from "@/lib/chartColors";
import {
  fetchArchives,
  fetchMonthlyGames,
  recentArchiveUrls,
  sortGamesNewestFirst,
  type ChessComGame,
} from "@/lib/chess";
import { fetchPursuitMembers, type PursuitMember } from "@/lib/pursuits";
import { createClient } from "@/lib/supabase/client";
import type { CachedAnalysis } from "../../chess/_view";

const OVERVIEW_MONTHS = 3;

interface MemberSummary {
  memberId: string;
  displayName: string;
  chessUsername: string;
  games: ChessComGame[];
  currentRatings: Partial<Record<"rapid" | "blitz" | "bullet", number>>;
  wins: number;
  losses: number;
  draws: number;
  avgAccuracy: number | null;
}

type SortKey = "member" | "games" | "winRate" | "accuracy" | "rating";

function myRating(g: ChessComGame, meLc: string): number | null {
  if (g.white.username.toLowerCase() === meLc) return g.white.rating;
  if (g.black.username.toLowerCase() === meLc) return g.black.rating;
  return null;
}

function myResult(g: ChessComGame, meLc: string): "win" | "loss" | "draw" | null {
  const iAmWhite = g.white.username.toLowerCase() === meLc;
  const iAmBlack = g.black.username.toLowerCase() === meLc;
  if (!iAmWhite && !iAmBlack) return null;
  const mine = iAmWhite ? g.white : g.black;
  if (mine.result === "win") return "win";
  if (["checkmated", "resigned", "timeout", "abandoned", "lose"].includes(mine.result)) return "loss";
  return "draw";
}

async function fetchMemberGames(chessUsername: string): Promise<ChessComGame[]> {
  const archives = await fetchArchives(chessUsername);
  if (archives.length === 0) return [];
  const urls = recentArchiveUrls(archives, OVERVIEW_MONTHS);
  const monthly = await Promise.all(urls.map((u) => fetchMonthlyGames(u).catch(() => [])));
  return sortGamesNewestFirst(monthly.flat().filter((g) => g.rules === "chess"));
}

function summarise(memberId: string, displayName: string, chessUsername: string, games: ChessComGame[], cache: Record<string, CachedAnalysis>): MemberSummary {
  const meLc = chessUsername.toLowerCase();
  const currentRatings: MemberSummary["currentRatings"] = {};
  let wins = 0, losses = 0, draws = 0;
  for (const g of games) {
    const tc = g.timeClass as "rapid" | "blitz" | "bullet";
    if ((tc === "rapid" || tc === "blitz" || tc === "bullet") && currentRatings[tc] == null) {
      const r = myRating(g, meLc);
      if (r != null) currentRatings[tc] = r;
    }
    const res = myResult(g, meLc);
    if (res === "win") wins++;
    else if (res === "loss") losses++;
    else if (res === "draw") draws++;
  }
  const accuracies = games
    .map((g) => cache[g.url]?.accuracy)
    .filter((a): a is number => typeof a === "number");
  const avgAccuracy =
    accuracies.length === 0 ? null : Math.round(accuracies.reduce((s, a) => s + a, 0) / accuracies.length);
  return { memberId, displayName, chessUsername, games, currentRatings, wins, losses, draws, avgAccuracy };
}

export default function PursuitOverview({
  pursuitId,
  pursuitMemberCount,
}: {
  pursuitId: string;
  pursuitMemberCount: number;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<MemberSummary[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "games", dir: "desc" });

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const supabase = createClient();
        // Fetch member roster + config in parallel.
        const [members, configRows] = await Promise.all([
          fetchPursuitMembers(pursuitId).catch<PursuitMember[]>(() => []),
          supabase
            .from("pursuit_members")
            .select("user_id, config")
            .eq("pursuit_id", pursuitId)
            .then((r) => r.data ?? []),
        ]);

        const configByUser = new Map<string, { username: string; cache: Record<string, CachedAnalysis> }>();
        for (const row of configRows as Array<{ user_id: string; config: any }>) {
          const chess = row.config?.chess ?? {};
          const username = typeof chess.username === "string" ? chess.username.trim() : "";
          if (!username) continue;
          configByUser.set(row.user_id, {
            username,
            cache: (chess.cache ?? {}) as Record<string, CachedAnalysis>,
          });
        }

        const withChess = members.filter((m) => configByUser.has(m.memberId));
        // Fan out chess.com fetches. Sequential-with-flatMap keeps it simple;
        // members list on a pursuit is small (<25 in practice).
        const results: MemberSummary[] = [];
        for (const m of withChess) {
          const cfg = configByUser.get(m.memberId)!;
          try {
            const games = await fetchMemberGames(cfg.username);
            results.push(summarise(m.memberId, m.displayName, cfg.username, games, cfg.cache));
          } catch {
            results.push(summarise(m.memberId, m.displayName, cfg.username, [], cfg.cache));
          }
        }
        if (!alive) return;
        setSummaries(results);
      } catch (e: any) {
        if (alive) setError(String(e?.message ?? e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [pursuitId]);

  const sorted = useMemo(() => {
    const rows = [...summaries];
    const mul = sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = rowValue(a, sort.key);
      const bv = rowValue(b, sort.key);
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av < bv ? -1 * mul : 1 * mul;
    });
    return rows;
  }, [summaries, sort]);

  // Rating over time — one line per member, using their best-populated format.
  const ratingRows = useMemo(() => {
    // Build a common x axis of every unique date across all members, then
    // stitch each member's rating series onto it.
    const perMember = summaries.map((m) => {
      const points: Array<{ date: string; rating: number }> = [];
      const meLc = m.chessUsername.toLowerCase();
      for (const g of [...m.games].sort((a, b) => a.endTime - b.endTime)) {
        const r = myRating(g, meLc);
        if (r != null) points.push({ date: new Date(g.endTime * 1000).toISOString().slice(0, 10), rating: r });
      }
      return { member: m.displayName, points };
    });
    const allDates = Array.from(new Set(perMember.flatMap((p) => p.points.map((x) => x.date)))).sort();
    return allDates.map((date) => {
      const row: Record<string, number | string | null> = { date };
      for (const p of perMember) {
        const hit = p.points.find((x) => x.date === date);
        row[p.member] = hit ? hit.rating : null;
      }
      return row;
    });
  }, [summaries]);

  const aggregate = useMemo(() => {
    const totalGames = summaries.reduce((s, m) => s + m.games.length, 0);
    const allRatings = summaries.flatMap((m) => Object.values(m.currentRatings));
    const avgRating =
      allRatings.length === 0 ? null : Math.round(allRatings.reduce((s, r) => s + r, 0) / allRatings.length);
    const mostActive =
      summaries.length === 0
        ? null
        : summaries.reduce((best, m) => (m.games.length > best.games.length ? m : best), summaries[0]);
    return { totalGames, avgRating, mostActive };
  }, [summaries]);

  if (loading) return <p className="text-xs text-muted">Loading pursuit overview…</p>;
  if (error) return <p className="text-xs font-medium text-danger">{error}</p>;
  if (summaries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed bg-surface p-4 text-xs text-muted">
        Nobody in this pursuit has set a chess.com username yet. Open the &ldquo;My data&rdquo; tab to add
        yours &mdash; you&apos;ll be the first on the overview.
      </p>
    );
  }

  const hint =
    summaries.length < pursuitMemberCount ? (
      <span className="text-[10px] text-faint">
        {summaries.length} of {pursuitMemberCount} members have set their chess.com username.
      </span>
    ) : null;

  return (
    <section className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Total games" value={aggregate.totalGames.toString()} sub={`${OVERVIEW_MONTHS}-month window`} />
        <Stat label="Avg rating" value={aggregate.avgRating?.toString() ?? "—"} sub="across formats" />
        <Stat
          label="Most active"
          value={aggregate.mostActive?.displayName ?? "—"}
          sub={aggregate.mostActive ? `${aggregate.mostActive.games.length} games` : ""}
        />
      </div>

      <div className="rounded-lg border bg-surface p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-semibold text-muted">Ratings over time</span>
          {hint}
        </div>
        {ratingRows.length === 0 ? (
          <p className="py-8 text-center text-xs text-faint">No rated games in the window.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={ratingRows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} width={36} />
              <Tooltip
                contentStyle={{ fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {summaries.map((m, i) => (
                <Line
                  key={m.memberId}
                  type="monotone"
                  dataKey={m.displayName}
                  stroke={chartSeries(i)}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border bg-surface">
        <table className="w-full text-xs">
          <thead className="text-[11px] uppercase tracking-wide text-faint">
            <tr className="border-b">
              <Th onClick={() => setSort((s) => flip(s, "member"))} label="Member" sort={sort} k="member" />
              <Th onClick={() => setSort((s) => flip(s, "rating"))} label="Current rating" sort={sort} k="rating" align="right" />
              <Th onClick={() => setSort((s) => flip(s, "games"))} label="Games" sort={sort} k="games" align="right" />
              <Th onClick={() => setSort((s) => flip(s, "winRate"))} label="Win %" sort={sort} k="winRate" align="right" />
              <Th onClick={() => setSort((s) => flip(s, "accuracy"))} label="Accuracy" sort={sort} k="accuracy" align="right" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => {
              const played = m.wins + m.losses + m.draws;
              const winPct = played === 0 ? null : Math.round((m.wins / played) * 100);
              const ratings = Object.entries(m.currentRatings)
                .map(([f, r]) => `${f.slice(0, 1)} ${r}`)
                .join(" · ");
              return (
                <tr key={m.memberId} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-medium text-ink">{m.displayName}</span>
                    <span className="ml-1 text-faint">@{m.chessUsername}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{ratings || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.games.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{winPct == null ? "—" : `${winPct}%`}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.avgAccuracy ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function rowValue(m: MemberSummary, k: SortKey): number | string | null {
  if (k === "member") return m.displayName.toLowerCase();
  if (k === "games") return m.games.length;
  if (k === "winRate") {
    const played = m.wins + m.losses + m.draws;
    return played === 0 ? null : m.wins / played;
  }
  if (k === "accuracy") return m.avgAccuracy;
  if (k === "rating") {
    const rs = Object.values(m.currentRatings);
    return rs.length === 0 ? null : Math.max(...rs);
  }
  return null;
}

function flip(current: { key: SortKey; dir: "asc" | "desc" }, next: SortKey): { key: SortKey; dir: "asc" | "desc" } {
  if (current.key === next) return { key: next, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key: next, dir: next === "member" ? "asc" : "desc" };
}

function Th({ label, onClick, sort, k, align }: { label: string; onClick: () => void; sort: { key: SortKey; dir: "asc" | "desc" }; k: SortKey; align?: "right" }) {
  const arrow = sort.key === k ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
  return (
    <th className={`cursor-pointer select-none px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`} onClick={onClick}>
      {label}
      <span className="text-faint">{arrow}</span>
    </th>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-surface p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-faint">{sub}</div>}
    </div>
  );
}
