"use client";

/**
 * Read-only chess board with move navigation. Dynamically imported so
 * `react-chessboard` (which pulls in a wagon of client-only modules) doesn't
 * add to the initial /chess bundle when the user hasn't picked a game yet.
 *
 * Optional `showMoveList` renders a scrollable numbered SAN list next to the
 * board and lets the user click a move to jump straight to that ply. The
 * current move is highlighted and auto-scrolled into view. Used from the
 * per-opponent detail section of the chess pursuit.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

interface Props {
  pgn: string;
  orientation: "white" | "black";
  /** Aligned with move index (half-plies), so cpLossPerMove[i] is the loss
   *  incurred by MY move at ply i-of-my-plies. Optional; when present we
   *  colour-tag the move in the move list. */
  cpLossPerMyMove?: Array<number | null> | null;
  myColour?: "white" | "black";
  /** Render a scrollable numbered move list side-by-side with the board.
   *  Click a move → jump the board to that ply. */
  showMoveList?: boolean;
}

export default function GameBoard({ pgn, orientation, cpLossPerMyMove, myColour, showMoveList = false }: Props) {
  // Parse PGN once. If chess.js can't parse, we short-circuit to a stub board
  // rather than throwing into the render tree.
  const parsed = useMemo(() => {
    try {
      const c = new Chess();
      c.loadPgn(pgn);
      const history = c.history({ verbose: true }) as Array<{ san: string; before: string; after: string; color: "w" | "b" }>;
      return { history, ok: true as const };
    } catch (e) {
      return { history: [], ok: false as const, error: String(e) };
    }
  }, [pgn]);

  const [ply, setPly] = useState(0); // 0 = starting position, N = after Nth half-move
  useEffect(() => setPly(0), [pgn]);

  const fen = ply === 0
    ? new Chess().fen()
    : parsed.history[ply - 1]?.after ?? new Chess().fen();

  // Map my-move index -> global ply so we can look up cpLoss for the CURRENT
  // move if I'm the mover.
  const myColourShort = myColour === "black" ? "b" : "w";
  const myMoveIndex = parsed.history.slice(0, ply).filter((h) => h.color === myColourShort).length - 1;
  const currentLoss = cpLossPerMyMove && myMoveIndex >= 0
    ? cpLossPerMyMove[myMoveIndex] ?? null
    : null;

  return (
    <div className={showMoveList ? "flex flex-col gap-3 sm:flex-row sm:items-start" : "flex flex-col gap-2"}>
      <div className="flex flex-col gap-2">
        {!parsed.ok && (
          <p className="text-xs text-danger">Couldn&apos;t parse this game&apos;s PGN — showing an empty board.</p>
        )}
        <div style={{ width: "min(360px, 100%)" }}>
          <Chessboard position={fen} boardOrientation={orientation} arePiecesDraggable={false} />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => setPly(0)} className="btn-ghost py-1 text-xs" disabled={ply === 0} aria-label="Reset to start">⏮</button>
          <button onClick={() => setPly((p) => Math.max(0, p - 1))} className="btn-ghost py-1 text-xs" disabled={ply === 0} aria-label="Previous move">◀</button>
          <span className="tabular-nums text-muted min-w-16 text-center">
            {ply === 0 ? "start" : `${Math.ceil(ply / 2)}${ply % 2 === 1 ? "." : "…"} ${parsed.history[ply - 1]?.san ?? ""}`}
          </span>
          <button onClick={() => setPly((p) => Math.min(parsed.history.length, p + 1))} className="btn-ghost py-1 text-xs" disabled={ply >= parsed.history.length} aria-label="Next move">▶</button>
          <button onClick={() => setPly(parsed.history.length)} className="btn-ghost py-1 text-xs" disabled={ply >= parsed.history.length} aria-label="Go to end">⏭</button>
          {currentLoss != null && (
            <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              currentLoss >= 200 ? "bg-danger/20 text-danger" : currentLoss >= 100 ? "bg-warning/20 text-warning" : currentLoss >= 50 ? "bg-surface-2 text-muted" : "text-faint"
            }`}
              title="Centipawn loss on your last move (Lichess cloud eval)"
            >
              {currentLoss >= 200 ? "?? blunder" : currentLoss >= 100 ? "? mistake" : currentLoss >= 50 ? "?! inacc." : "ok"} · −{Math.round(currentLoss)}cp
            </span>
          )}
        </div>
      </div>
      {showMoveList && parsed.ok && (
        <MoveList
          history={parsed.history}
          ply={ply}
          onSelect={setPly}
          myColourShort={myColourShort}
          cpLossPerMyMove={cpLossPerMyMove ?? null}
        />
      )}
    </div>
  );
}

/**
 * Scrollable SAN move list. Each half-move is a clickable pill; clicking one
 * jumps the board to that ply. Auto-scrolls the current move into view when
 * the ply changes (via ⏮/◀/▶/⏭ or another click) so the user doesn't have to
 * hunt for it in a long game.
 */
function MoveList({
  history,
  ply,
  onSelect,
  myColourShort,
  cpLossPerMyMove,
}: {
  history: Array<{ san: string; color: "w" | "b" }>;
  ply: number;
  onSelect: (p: number) => void;
  myColourShort: "w" | "b";
  cpLossPerMyMove: Array<number | null> | null;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [ply]);

  // Pair up plies into full moves (white + black) so we render `1. e4 e5`
  // instead of a raw list of half-moves. The last row is a single move when
  // the game ended on white.
  type Cell = { san: string; ply: number; myMoveIdx: number | null } | null;
  const rows: Array<{ n: number; white: Cell; black: Cell }> = [];
  let myMoveCount = 0;
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    const isMine = h.color === myColourShort;
    const cell: Cell = { san: h.san, ply: i + 1, myMoveIdx: isMine ? myMoveCount : null };
    if (isMine) myMoveCount += 1;
    const rowIdx = Math.floor(i / 2);
    if (i % 2 === 0) rows.push({ n: rowIdx + 1, white: cell, black: null });
    else rows[rowIdx].black = cell;
  }

  const lossClass = (loss: number | null) =>
    loss == null
      ? ""
      : loss >= 200
      ? "text-danger"
      : loss >= 100
      ? "text-warning"
      : loss >= 50
      ? "text-muted"
      : "";

  return (
    <div className="flex-1 min-w-0 rounded-lg border bg-surface">
      <div className="border-b px-2 py-1 text-[11px] font-semibold text-muted">Moves</div>
      <ol className="max-h-[360px] overflow-y-auto p-1 text-xs tabular-nums">
        {rows.map((row) => (
          <li key={row.n} className="flex items-center gap-1 px-1 py-0.5">
            <span className="w-6 shrink-0 text-right text-faint">{row.n}.</span>
            {(["white", "black"] as const).map((side) => {
              const cell = row[side];
              if (!cell) return <span key={side} className="w-14" />;
              const active = cell.ply === ply;
              const loss = cell.myMoveIdx != null && cpLossPerMyMove ? cpLossPerMyMove[cell.myMoveIdx] ?? null : null;
              return (
                <button
                  key={side}
                  ref={active ? activeRef : undefined}
                  onClick={() => onSelect(cell.ply)}
                  className={`w-14 shrink-0 rounded px-1 py-0.5 text-left transition ${
                    active ? "bg-accent text-accent-contrast font-semibold" : "hover:bg-surface-2"
                  } ${!active ? lossClass(loss) : ""}`}
                  title={loss != null ? `${Math.round(loss)}cp loss` : undefined}
                >
                  {cell.san}
                </button>
              );
            })}
          </li>
        ))}
      </ol>
    </div>
  );
}
