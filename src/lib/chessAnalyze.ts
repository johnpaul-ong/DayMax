/**
 * Turn a chess.com game (PGN) into a per-my-move centipawn-loss array by
 * walking the game and asking Lichess' cloud-eval cache for each position.
 *
 * Separate from `chess.ts` because `chess.js` is a browser-friendly ESM
 * import that also happens to work in node, but keeping it here means the
 * pure helpers in chess.ts stay dependency-free and cheap to unit-test.
 */

import { Chess } from "chess.js";
import {
  coverageOf,
  fetchCloudEval,
  myColour,
  normaliseCp,
  tallyMistakes,
  type AnalyzedGame,
  type ChessComGame,
} from "./chess";

/**
 * Concurrency for cloud-eval fetches per game. Lichess docs don't publish a
 * hard limit for cloud-eval and it's a cheap cache lookup, but a rude request
 * pattern is a good way to get IP-banned. 4 in flight is polite; each fetch
 * is small so throughput is fine.
 */
const CONCURRENCY = 4;

/**
 * Analyse ONE game. Returns null if the game does not include the tracked
 * user (guard for calls that lose track).
 *
 * On any per-position fetch failure we set that ply's loss to null rather
 * than aborting the whole game — you get partial coverage instead of nothing.
 */
export async function analyseGame(g: ChessComGame, me: string, opts?: { signal?: AbortSignal }): Promise<AnalyzedGame | null> {
  const colour = myColour(g, me);
  if (!colour) return null;

  const chess = new Chess();
  try {
    // chess.js accepts the whole chess.com PGN including headers.
    chess.loadPgn(g.pgn);
  } catch {
    // Malformed PGN — the game still renders in the list without analysis.
    return {
      ...g,
      myColour: colour,
      opponent: colour === "white" ? g.black.username : g.white.username,
      blunders: null,
      mistakes: null,
      inaccuracies: null,
      cpLossPerMove: null,
      coverage: 0,
    };
  }
  const history = chess.history({ verbose: true }) as Array<{ before: string; after: string; color: "w" | "b" }>;
  const myColourShort: "w" | "b" = colour === "white" ? "w" : "b";
  const myPlies = history
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.color === myColourShort);

  // Fetch cloud-eval for BOTH `before` (choice frame) and `after` (result
  // of my move). cp-loss = eval(after) - eval(before) from my perspective;
  // if my move maintains the eval, loss is ~0. All from white's POV.
  const uniqueFens = new Set<string>();
  for (const { h } of myPlies) {
    uniqueFens.add(h.before);
    uniqueFens.add(h.after);
  }

  // Simple concurrency-limited fetch fan-out. Avoids depending on p-limit.
  const evals = new Map<string, Awaited<ReturnType<typeof fetchCloudEval>>>();
  const fens = Array.from(uniqueFens);
  let i = 0;
  async function worker() {
    while (i < fens.length) {
      if (opts?.signal?.aborted) return;
      const idx = i++;
      const fen = fens[idx];
      const ev = await fetchCloudEval(fen);
      evals.set(fen, ev);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, fens.length) }, worker));

  const cpLoss: Array<number | null> = myPlies.map(({ h }) => {
    const before = evals.get(h.before);
    const after = evals.get(h.after);
    if (!before || !after) return null;
    // side-to-move on `before` = ME (I'm about to move). side-to-move on
    // `after` = opponent. Normalise both to WHITE-relative cp, then convert
    // to loss from MY perspective.
    const beforeCp = normaliseCp(myColourShort, before.cp, before.mate);
    const afterCp = normaliseCp(oppOf(myColourShort), after.cp, after.mate);
    const mySign = myColourShort === "w" ? 1 : -1;
    // My eval before move (from my POV) minus after (from my POV). Larger
    // positive = I gave up more equity.
    return mySign * beforeCp - mySign * afterCp;
  });

  const totals = tallyMistakes(cpLoss);
  const coverage = coverageOf(cpLoss);

  return {
    ...g,
    myColour: colour,
    opponent: colour === "white" ? g.black.username : g.white.username,
    blunders: coverage > 0 ? totals.blunders : null,
    mistakes: coverage > 0 ? totals.mistakes : null,
    inaccuracies: coverage > 0 ? totals.inaccuracies : null,
    cpLossPerMove: cpLoss,
    coverage,
  };
}

function oppOf(c: "w" | "b"): "w" | "b" {
  return c === "w" ? "b" : "w";
}
