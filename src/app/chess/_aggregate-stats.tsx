"use client";

/**
 * Aggregate stats for the chess pursuit — top section of the redesigned view.
 *
 * Renders across ALL games in the fetch window (not filtered by opponent):
 *   - rating snapshot per time-class (rapid / blitz / bullet): current + best
 *   - rating over time (LineChart, one line per format)
 *   - wins / losses / draws (BarChart)
 *   - wins as white vs wins as black, grouped by W/L/D (BarChart)
 *   - avg centipawn loss over time (LineChart, sparse where Lichess had no
 *     cache hit — those games are OMITTED from the series so the gap reads as
 *     "no eval" rather than a bogus zero)
 *
 * Recharts is the codebase's chart library (six existing usages), so nothing
 * new here — we just use the existing chartColors palette so the series
 * colours match the rest of the app across light and dark.
 */

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_DANGER, CHART_MUTED, CHART_OK, chartSeries } from "@/lib/chartColors";
import type { AnalyzedGame, ChessComGame } from "@/lib/chess";

const TRACKED_FORMATS = ["rapid", "blitz", "bullet"] as const;
type Format = (typeof TRACKED_FORMATS)[number];

interface Props {
  games: ChessComGame[];
  analyzed: Map<string, AnalyzedGame>;
  me: string;
}

/** Return my rating in this game if I played it, else null (game with a
 *  different account — shouldn't happen but be defensive). */
function myRating(g: ChessComGame, meLc: string): number | null {
  if (g.white.username.toLowerCase() === meLc) return g.white.rating;
  if (g.black.username.toLowerCase() === meLc) return g.black.rating;
  return null;
}

/** "win" / "loss" / "draw" from my POV. */
function myResult(g: ChessComGame, meLc: string): "win" | "loss" | "draw" | null {
  const iAmWhite = g.white.username.toLowerCase() === meLc;
  const iAmBlack = g.black.username.toLowerCase() === meLc;
  if (!iAmWhite && !iAmBlack) return null;
  const mine = iAmWhite ? g.white : g.black;
  if (mine.result === "win") return "win";
  if (["checkmated", "resigned", "timeout", "abandoned", "lose"].includes(mine.result)) return "loss";
  return "draw";
}

export default function AggregateStats({ games, analyzed, me }: Props) {
  const meLc = me.trim().toLowerCase();

  // Snapshot per format: current (latest game's rating) + best (max over window).
  const perFormat = useMemo(() => {
    const acc: Record<Format, { current: number | null; best: number | null; count: number }> = {
      rapid: { current: null, best: null, count: 0 },
      blitz: { current: null, best: null, count: 0 },
      bullet: { current: null, best: null, count: 0 },
    };
    // games are sorted newest-first at the caller, so the first hit per
    // format is the CURRENT rating and we max across all for BEST.
    for (const g of games) {
      const f = g.timeClass as Format;
      if (!TRACKED_FORMATS.includes(f)) continue;
      const r = myRating(g, meLc);
      if (r == null) continue;
      acc[f].count += 1;
      if (acc[f].current == null) acc[f].current = r;
      if (acc[f].best == null || r > acc[f].best) acc[f].best = r;
    }
    return acc;
  }, [games, meLc]);

  // Rating over time: one row per game (oldest → newest for recharts x-axis),
  // one COLUMN per format. Recharts skips gaps in a Line when the value is
  // null, so this handles the "different formats don't share game timestamps"
  // problem naturally.
  const ratingRows = useMemo(() => {
    const rows = [...games]
      .filter((g) => TRACKED_FORMATS.includes(g.timeClass as Format))
      .sort((a, b) => a.endTime - b.endTime)
      .map((g) => {
        const row: { date: string; rapid: number | null; blitz: number | null; bullet: number | null } = {
          date: new Date(g.endTime * 1000).toISOString().slice(0, 10),
          rapid: null,
          blitz: null,
          bullet: null,
        };
        const r = myRating(g, meLc);
        if (r != null) row[g.timeClass as Format] = r;
        return row;
      });
    return rows;
  }, [games, meLc]);

  // W/L/D counts overall.
  const wldTotals = useMemo(() => {
    const t = { win: 0, loss: 0, draw: 0 };
    for (const g of games) {
      const r = myResult(g, meLc);
      if (r) t[r] += 1;
    }
    return t;
  }, [games, meLc]);

  // W/L/D split by side.
  const byColour = useMemo(() => {
    const acc = {
      white: { win: 0, loss: 0, draw: 0 },
      black: { win: 0, loss: 0, draw: 0 },
    };
    for (const g of games) {
      const r = myResult(g, meLc);
      if (!r) continue;
      const iAmWhite = g.white.username.toLowerCase() === meLc;
      acc[iAmWhite ? "white" : "black"][r] += 1;
    }
    return acc;
  }, [games, meLc]);

  // Accuracy proxy: 100 - avg centipawn loss / 5, floored at 0. Chess.com's
  // own metric is a closed-source polynomial; this is a rough stand-in that
  // moves the right direction. Games without eval coverage are OMITTED.
  const accuracyRows = useMemo(() => {
    return [...games]
      .sort((a, b) => a.endTime - b.endTime)
      .map((g) => {
        const a = analyzed.get(g.url);
        if (!a || !a.cpLossPerMove || a.coverage <= 0) return null;
        const evaluated = a.cpLossPerMove.filter((l): l is number => l != null);
        if (evaluated.length === 0) return null;
        const avg = evaluated.reduce((s, l) => s + l, 0) / evaluated.length;
        const accuracy = Math.max(0, Math.min(100, 100 - avg / 5));
        return { date: new Date(g.endTime * 1000).toISOString().slice(0, 10), accuracy: Math.round(accuracy) };
      })
      .filter((r): r is { date: string; accuracy: number } => r !== null);
  }, [games, analyzed]);

  const wldData = [
    { label: "Wins", value: wldTotals.win, fill: CHART_OK },
    { label: "Losses", value: wldTotals.loss, fill: CHART_DANGER },
    { label: "Draws", value: wldTotals.draw, fill: CHART_MUTED },
  ];

  const colourData = [
    { side: "As white", win: byColour.white.win, loss: byColour.white.loss, draw: byColour.white.draw },
    { side: "As black", win: byColour.black.win, loss: byColour.black.loss, draw: byColour.black.draw },
  ];

  const total = games.length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-sm font-semibold">Overall</h2>
        <span className="text-xs text-faint">
          {total} game{total === 1 ? "" : "s"} · last 6 months
        </span>
      </div>

      {/* Rating snapshot chips per format. Missing formats render as a
          muted placeholder so the row keeps its shape. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {TRACKED_FORMATS.map((f, i) => {
          const p = perFormat[f];
          return (
            <div key={f} className="rounded-lg border bg-surface p-3">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted">
                <span style={{ color: chartSeries(i) }}>●</span>
                <span>{f}</span>
                <span className="text-faint">{p.count}g</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums">{p.current ?? "—"}</span>
                <span className="text-xs text-faint">now</span>
              </div>
              <div className="text-xs text-muted">
                best <span className="tabular-nums">{p.best ?? "—"}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Rating over time — three lines. Compact height because rating trends
          are legible without a lot of vertical space. */}
      <div className="rounded-lg border bg-surface p-3">
        <div className="mb-2 text-xs font-semibold text-muted">Rating over time</div>
        {ratingRows.length === 0 ? (
          <p className="py-8 text-center text-xs text-faint">No rated standard games in the window.</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={ratingRows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} width={36} />
              <Tooltip
                contentStyle={{ fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)" }}
                labelStyle={{ color: "var(--muted)" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {TRACKED_FORMATS.map((f, i) => (
                <Line
                  key={f}
                  type="monotone"
                  dataKey={f}
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

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border bg-surface p-3">
          <div className="mb-2 text-xs font-semibold text-muted">Wins · losses · draws</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={wldData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} width={30} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)" }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border bg-surface p-3">
          <div className="mb-2 text-xs font-semibold text-muted">By side played</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={colourData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="side" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} width={30} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="win" fill={CHART_OK} name="Win" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="loss" fill={CHART_DANGER} name="Loss" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="draw" fill={CHART_MUTED} name="Draw" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border bg-surface p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-semibold text-muted">Accuracy over time</span>
          <span className="text-[10px] text-faint">
            {accuracyRows.length} of {games.length} games have cached eval
          </span>
        </div>
        {accuracyRows.length === 0 ? (
          <p className="py-8 text-center text-xs text-faint">
            No cached Lichess evals for these games yet. Accuracy fills in as evals arrive.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={accuracyRows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={30} />
              <Tooltip
                contentStyle={{ fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)" }}
              />
              <Line
                type="monotone"
                dataKey="accuracy"
                stroke={chartSeries(3)}
                strokeWidth={2}
                dot={{ r: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
