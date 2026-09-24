"use client";

/**
 * Read-only chess board with move navigation. Dynamically imported by
 * `page.tsx` so `react-chessboard` (which pulls in a wagon of client-only
 * modules) doesn't add to the initial /chess bundle when the user hasn't
 * picked a game yet.
 */

import { useEffect, useMemo, useState } from "react";
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
}

export default function GameBoard({ pgn, orientation, cpLossPerMyMove, myColour }: Props) {
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
  );
}
