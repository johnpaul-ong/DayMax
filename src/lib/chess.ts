/**
 * chess.com fetch + Lichess cloud-eval analysis for the /chess pursuit page.
 *
 * SCOPE (first cut): show a user's recent games against a hand-picked list of
 * opponents, with per-game rating and a "blunders" count derived from Lichess'
 * cached cloud evaluations. No engine runs on-device yet; on cache miss the
 * game is flagged as analysis-unavailable rather than blocking the UI. See
 * `03-execution.md` in the trace for the modify-vs-add / storage decisions.
 */

/* No `use client` header: this module is imported from client components and
 * used with the browser's fetch, but it is pure enough that a Node test file
 * can also exercise the pure helpers below. */

export interface ChessComGame {
  /** chess.com game URL — stable id for de-dupe / storage. */
  url: string;
  /** Server-provided end time in unix seconds. */
  endTime: number;
  /** "chess", "chess960", "bughouse" etc — we care about "chess" for now. */
  rules: string;
  /** "rapid" / "blitz" / "bullet" / "daily". */
  timeClass: string;
  /** raw PGN including headers. */
  pgn: string;
  white: { username: string; rating: number | null; result: string };
  black: { username: string; rating: number | null; result: string };
}

export interface AnalyzedGame extends ChessComGame {
  /** the tracked user's colour in THIS game (from usernameLc). */
  myColour: "white" | "black";
  opponent: string;
  /** blunder / mistake / inaccuracy tally for the tracked user, computed from
   *  centipawn-loss on each of my moves. null = analysis unavailable (no
   *  Lichess cache hit for at least one required position). */
  blunders: number | null;
  mistakes: number | null;
  inaccuracies: number | null;
  /** per-move centipawn loss for the tracked user, plies aligned with my moves.
   *  null entries = no eval for that ply (Lichess cache miss). */
  cpLossPerMove: Array<number | null> | null;
  /** how much of the analysis was cached: 0..1. Useful "eval unavailable"
   *  gate. */
  coverage: number;
}

// -- pure helpers -------------------------------------------------------------

/**
 * Blunder / mistake / inaccuracy thresholds in centipawns (of loss vs the
 * best move at that position). The 200cp = "blunder" threshold matches what
 * Lichess and chess.com both display for their built-in reviewers.
 */
export const BLUNDER_CP = 200;
export const MISTAKE_CP = 100;
export const INACCURACY_CP = 50;

/**
 * chess.com public API is unauthenticated but the docs explicitly ask for a
 * descriptive User-Agent so they can contact the operator if the app misbehaves.
 * A missing UA gets you sporadic 403s. Only settable on server-side fetch — the
 * browser silently strips it — so we send it opportunistically.
 */
const UA = "daymax/0.1 (chess-pursuit; https://github.com/)";

/** Parse a chess.com archives listing into monthly URLs (newest last). */
export function parseArchivesResponse(json: any): string[] {
  const arr = Array.isArray(json?.archives) ? json.archives : [];
  return arr.filter((u: any) => typeof u === "string");
}

/** Which archive URLs to hit for `months` most recent months. */
export function recentArchiveUrls(archives: string[], months: number): string[] {
  if (months <= 0) return [];
  return archives.slice(-months);
}

/**
 * Filter a batch of games to those where one player is `me` (case-insensitive)
 * AND the other is in `opponents` (case-insensitive). Standard chess only.
 */
export function filterGamesVsOpponents(
  games: ChessComGame[],
  me: string,
  opponents: string[]
): ChessComGame[] {
  const meLc = me.toLowerCase();
  const oppSet = new Set(opponents.map((o) => o.toLowerCase()));
  return games.filter((g) => {
    if (g.rules !== "chess") return false;
    const w = g.white.username.toLowerCase();
    const b = g.black.username.toLowerCase();
    if (w === meLc && oppSet.has(b)) return true;
    if (b === meLc && oppSet.has(w)) return true;
    return false;
  });
}

/** Newest first. */
export function sortGamesNewestFirst(games: ChessComGame[]): ChessComGame[] {
  return [...games].sort((a, b) => b.endTime - a.endTime);
}

/**
 * Turn a raw chess.com monthly-games response into ChessComGame[].
 * Skips entries that lack a PGN because we can't do anything useful with them.
 */
export function normaliseMonthlyGames(json: any): ChessComGame[] {
  const arr = Array.isArray(json?.games) ? json.games : [];
  const out: ChessComGame[] = [];
  for (const g of arr) {
    if (typeof g?.pgn !== "string" || !g.pgn) continue;
    out.push({
      url: String(g.url ?? ""),
      endTime: Number(g.end_time ?? 0),
      rules: String(g.rules ?? "chess"),
      timeClass: String(g.time_class ?? "unknown"),
      pgn: g.pgn,
      white: {
        username: String(g.white?.username ?? ""),
        rating: g.white?.rating == null ? null : Number(g.white.rating),
        result: String(g.white?.result ?? ""),
      },
      black: {
        username: String(g.black?.username ?? ""),
        rating: g.black?.rating == null ? null : Number(g.black.rating),
        result: String(g.black?.result ?? ""),
      },
    });
  }
  return out;
}

/**
 * Count blunders/mistakes/inaccuracies from a per-move centipawn-loss array.
 * `null` entries (no eval for that ply) are skipped — they do not increment
 * any bucket AND they do not incorrectly attribute a mistake to the player.
 */
export function tallyMistakes(cpLoss: Array<number | null>) {
  let blunders = 0;
  let mistakes = 0;
  let inaccuracies = 0;
  for (const l of cpLoss) {
    if (l == null) continue;
    if (l >= BLUNDER_CP) blunders++;
    else if (l >= MISTAKE_CP) mistakes++;
    else if (l >= INACCURACY_CP) inaccuracies++;
  }
  return { blunders, mistakes, inaccuracies };
}

/**
 * Coverage of the analysis: fraction of my-move plies that had an eval on
 * both sides of the move (needed to compute cp-loss). Used to gate whether
 * we call the whole game "analysed" or "eval unavailable".
 */
export function coverageOf(cpLoss: Array<number | null>): number {
  if (cpLoss.length === 0) return 0;
  const hit = cpLoss.filter((l) => l != null).length;
  return hit / cpLoss.length;
}

/**
 * Standardise a Lichess cloud-eval `pvs[0].cp` (score in centipawns from the
 * side-to-move's perspective) into a score in centipawns from WHITE's
 * perspective. Mate scores collapse to a large sentinel so the diffs still
 * compute sensibly but never dominate the arithmetic.
 */
export function normaliseCp(sideToMove: "w" | "b", cp: number | null, mate: number | null): number {
  const MATE_CP = 10_000;
  let raw: number;
  if (mate != null) raw = mate > 0 ? MATE_CP - mate : -MATE_CP - mate;
  else if (cp != null) raw = cp;
  else return 0;
  return sideToMove === "w" ? raw : -raw;
}

/** True if the tracked user's username matches the WHITE player in this game. */
export function myColour(g: ChessComGame, me: string): "white" | "black" | null {
  const meLc = me.toLowerCase();
  if (g.white.username.toLowerCase() === meLc) return "white";
  if (g.black.username.toLowerCase() === meLc) return "black";
  return null;
}

// -- network layer ------------------------------------------------------------

/**
 * Fetch a chess.com player's archive URLs. Returns [] on 404 (unknown user)
 * rather than throwing, so the UI can render a "no games" message cleanly.
 */
export async function fetchArchives(username: string): Promise<string[]> {
  const url = `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`chess.com archives ${r.status} for ${username}`);
  return parseArchivesResponse(await r.json());
}

/** Fetch one month's games from a full monthly-URL. */
export async function fetchMonthlyGames(monthlyUrl: string): Promise<ChessComGame[]> {
  const r = await fetch(monthlyUrl, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!r.ok) throw new Error(`chess.com month ${r.status} for ${monthlyUrl}`);
  return normaliseMonthlyGames(await r.json());
}

/**
 * Fetch a Lichess cloud eval for one FEN. Returns null on 404 (cache miss) or
 * any other non-2xx — treat as "no engine info for this position".
 */
export interface LichessCloudEval {
  cp: number | null;
  mate: number | null;
  bestMove: string | null;
  depth: number;
}

export async function fetchCloudEval(fen: string): Promise<LichessCloudEval | null> {
  const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=1`;
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    const pv = Array.isArray(j?.pvs) ? j.pvs[0] : null;
    if (!pv) return null;
    return {
      cp: typeof pv.cp === "number" ? pv.cp : null,
      mate: typeof pv.mate === "number" ? pv.mate : null,
      bestMove: typeof pv.moves === "string" ? pv.moves.split(" ")[0] : null,
      depth: typeof j?.depth === "number" ? j.depth : 0,
    };
  } catch {
    return null;
  }
}
