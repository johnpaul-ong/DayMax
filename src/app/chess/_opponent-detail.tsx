"use client";

/**
 * Per-opponent detail — bottom section of the redesigned chess pursuit view.
 *
 * Renders for ONE selected opponent (parent owns the selection state):
 *   - head-to-head stat block (total games, W/L/D, win-% as white vs black)
 *   - per-opponent accuracy chart
 *   - games list (existing pattern — click a game to open the board)
 *   - board + scrollable move list side-by-side (the move-jumpable review)
 *
 * The move-list rendering lives in `_board.tsx` behind `showMoveList` so both
 * pieces of state (parsed history + current ply) stay together.
 */

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartSeries } from "@/lib/chartColors";
import type { AnalyzedGame, ChessComGame } from "@/lib/chess";

const GameBoard = dynamic(() => import("./_board"), {
  ssr: false,
  loading: () => <div className="text-xs text-muted">loading board…</div>,
});

interface Props {
  opponent: string;
  games: ChessComGame[]; // ALREADY filtered vs this opponent, newest-first.
  analyzed: Map<string, AnalyzedGame>;
  me: string;
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

export default function OpponentDetail({ opponent, games, analyzed, me }: Props) {
  const meLc = me.trim().toLowerCase();
  const [selectedUrl, setSelectedUrl] = useState<string | null>(() => games[0]?.url ?? null);

  // Reset selection if the opponent changes and the previously-selected game
  // is no longer in the list.
  useMemo(() => {
    if (selectedUrl && !games.some((g) => g.url === selectedUrl)) {
      setSelectedUrl(games[0]?.url ?? null);
    }
  }, [games, selectedUrl]);

  const stats = useMemo(() => {
    const t = { total: 0, win: 0, loss: 0, draw: 0, whiteN: 0, whiteWins: 0, blackN: 0, blackWins: 0 };
    for (const g of games) {
      const r = myResult(g, meLc);
      if (!r) continue;
      t.total += 1;
      t[r] += 1;
      const iAmWhite = g.white.username.toLowerCase() === meLc;
      if (iAmWhite) {
        t.whiteN += 1;
        if (r === "win") t.whiteWins += 1;
      } else {
        t.blackN += 1;
        if (r === "win") t.blackWins += 1;
      }
    }
    return t;
  }, [games, meLc]);

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

  const selected = useMemo(() => games.find((g) => g.url === selectedUrl) ?? null, [games, selectedUrl]);
  const selectedAnalyzed = selectedUrl ? analyzed.get(selectedUrl) ?? null : null;

  const pct = (num: number, den: number) => (den === 0 ? "—" : `${Math.round((num / den) * 100)}%`);

  if (stats.total === 0) {
    return (
      <p className="rounded-lg border bg-surface p-4 text-xs text-faint">
        No games against <b>{opponent}</b> in the last 6 months yet.
      </p>
    );
  }

  return (
    <section className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Head to head" value={`${stats.win}–${stats.loss}–${stats.draw}`} sub={`${stats.total} games`} />
        <Stat label="Win rate" value={pct(stats.win, stats.total)} sub="all games" />
        <Stat label="Win % as white" value={pct(stats.whiteWins, stats.whiteN)} sub={`${stats.whiteN} games`} />
        <Stat label="Win % as black" value={pct(stats.blackWins, stats.blackN)} sub={`${stats.blackN} games`} />
      </div>

      <div className="rounded-lg border bg-surface p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-semibold text-muted">Accuracy vs {opponent}</span>
          <span className="text-[10px] text-faint">
            {accuracyRows.length} of {games.length} have cached eval
          </span>
        </div>
        {accuracyRows.length === 0 ? (
          <p className="py-6 text-center text-xs text-faint">No cached Lichess evals for these games yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
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

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Games vs {opponent}</h3>
          <ul className="space-y-2">
            {games.map((g) => {
              const a = analyzed.get(g.url);
              const isSelected = g.url === selectedUrl;
              const iAmWhite = g.white.username.toLowerCase() === meLc;
              const opp = iAmWhite ? g.black : g.white;
              const mine = iAmWhite ? g.white : g.black;
              const resultLabel = mine.result === "win" ? "W" : ["checkmated", "resigned", "timeout"].includes(mine.result) ? "L" : "½";
              return (
                <li key={g.url}>
                  <button
                    onClick={() => setSelectedUrl(g.url)}
                    className={`w-full rounded-lg border p-2 text-left text-xs transition ${
                      isSelected ? "border-accent bg-accent-soft" : "bg-surface hover:border-accent-soft"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                          resultLabel === "W"
                            ? "bg-ok/20 text-ok"
                            : resultLabel === "L"
                            ? "bg-danger/20 text-danger"
                            : "bg-surface-2 text-muted"
                        }`}
                      >
                        {resultLabel}
                      </span>
                      <span className="font-semibold">as {iAmWhite ? "white" : "black"}</span>
                      <span className="text-faint">
                        ({opp.rating ?? "?"} · {g.timeClass})
                      </span>
                      <span className="ml-auto text-faint tabular-nums">{new Date(g.endTime * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px]">
                      {a?.blunders != null ? (
                        <>
                          <span title="Blunders (≥200cp loss on your move)">?? {a.blunders}</span>
                          <span title="Mistakes (≥100cp)">? {a.mistakes}</span>
                          <span title="Inaccuracies (≥50cp)">?! {a.inaccuracies}</span>
                          <span className="text-faint">coverage {Math.round(a.coverage * 100)}%</span>
                        </>
                      ) : a ? (
                        <span className="text-faint">eval unavailable</span>
                      ) : (
                        <span className="text-faint">analysing…</span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Board · moves</h3>
          {selected ? (
            <div className="rounded-lg border bg-surface p-2">
              <GameBoard
                pgn={selected.pgn}
                orientation={selectedAnalyzed?.myColour ?? "white"}
                cpLossPerMyMove={selectedAnalyzed?.cpLossPerMove ?? null}
                myColour={selectedAnalyzed?.myColour}
                showMoveList
              />
              <a
                href={selected.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-[11px] text-accent hover:underline"
              >
                Open on chess.com ↗
              </a>
            </div>
          ) : (
            <p className="text-xs text-faint">Pick a game to review it move by move.</p>
          )}
        </div>
      </div>
    </section>
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
