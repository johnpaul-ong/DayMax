"use client";

/**
 * Shared chess pursuit view. Composes three sections:
 *
 *   1. ConfigPanel        — username (read-only + inline edit) + opponents
 *                            (compact <details> menu) + a small icon refresh.
 *   2. AggregateStats     — snapshot + charts across ALL games in the window.
 *   3. OpponentDetail     — per-selected-opponent stats + games + review board
 *                            with an on-demand "Analyse this game" button.
 *
 * Rendered by both `/chess` (standalone, before the redirect fires) and
 * `/pursuits/[id]` (the templated Chess pursuit). Both surfaces stay in sync
 * because all chess-specific UI lives here.
 *
 * Fetch window is CAPPED and lazy: the first fetch grabs the last
 * FETCH_MONTHS_STEP months only (default 3). "Load more" extends the window
 * in FETCH_MONTHS_STEP-month steps. The cap exists because a Hikaru-scale
 * account plays thousands of games a month; a naive 12-month fetch × 2 FEN
 * fetches per move × Lichess rate limits would blow up. Three months is
 * enough for a casual player's rating trend and a handful of head-to-heads
 * against a set opponent, and the button lets a heavier user go deeper on
 * request.
 *
 * Analysis is ALSO on-demand: fetch pulls games and shows the board + SAN
 * move list immediately (no cp-loss badges yet). The user clicks
 * "Analyse this game" on the selected game to run Lichess for it. Result
 * is persisted upstream (per-member cache) so a revisit shows the badges
 * immediately without re-hitting Lichess. Aggregate charts (accuracy over
 * time) render only games that already have analysis — a game with no
 * analysis is OMITTED from the series (gap-not-zero), keeping the existing
 * "no eval => not on the chart" pattern.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchArchives,
  fetchMonthlyGames,
  recentArchiveUrls,
  sortGamesNewestFirst,
  type AnalyzedGame,
  type ChessComGame,
} from "@/lib/chess";
import { analyseGame } from "@/lib/chessAnalyze";
import AggregateStats from "./_aggregate-stats";
import OpponentDetail from "./_opponent-detail";

/** Months per "load more" click. 3 keeps the fetch small; the button lets
 *  heavier users go deeper. */
const FETCH_MONTHS_STEP = 3;

export interface ChessConfig {
  username: string;
  opponents: string[];
}

export const CHESS_DEFAULTS: ChessConfig = { username: "", opponents: [] };

/** Normalise anything a jsonb/localStorage read might return into a valid
 *  config. Legacy rows may carry `monthsBack` -- we ignore it. */
export function normaliseChessConfig(raw: unknown): ChessConfig {
  const j = (raw ?? {}) as Record<string, unknown>;
  return {
    username: typeof j.username === "string" ? j.username : "",
    opponents: Array.isArray(j.opponents)
      ? j.opponents.filter((s: unknown): s is string => typeof s === "string")
      : [],
  };
}

/** One cached analysis entry, keyed by chess.com game URL upstream. */
export interface CachedAnalysis {
  cpLossPerMove: Array<number | null>;
  myColour: "white" | "black";
  blunders: number | null;
  mistakes: number | null;
  inaccuracies: number | null;
  coverage: number;
  accuracy: number | null;
  analysedAt: string;
}

interface Props {
  config: ChessConfig;
  onConfigChange: (c: ChessConfig) => void;
  configLoaded: boolean;
  showHeader?: boolean;
  /** Initial per-game analysis cache, keyed by chess.com game URL. Falls back
   *  to an empty map on first mount. */
  analysisCache?: Record<string, CachedAnalysis>;
  /** Called once per analysed game so the parent can persist the entry.
   *  Parent debounces writes; child only fires per successful analysis. */
  onAnalysisCached?: (gameUrl: string, entry: CachedAnalysis) => void;
}

/** Hydrate a cached entry back into the AnalyzedGame shape the child
 *  components expect. */
function hydrateCached(g: ChessComGame, c: CachedAnalysis): AnalyzedGame {
  return {
    ...g,
    myColour: c.myColour,
    opponent: c.myColour === "white" ? g.black.username : g.white.username,
    blunders: c.blunders,
    mistakes: c.mistakes,
    inaccuracies: c.inaccuracies,
    cpLossPerMove: c.cpLossPerMove,
    coverage: c.coverage,
  };
}

function toCached(a: AnalyzedGame): CachedAnalysis {
  const evaluated = (a.cpLossPerMove ?? []).filter((l): l is number => l != null);
  const accuracy =
    evaluated.length === 0
      ? null
      : Math.round(Math.max(0, Math.min(100, 100 - evaluated.reduce((s, l) => s + l, 0) / evaluated.length / 5)));
  return {
    cpLossPerMove: a.cpLossPerMove ?? [],
    myColour: a.myColour,
    blunders: a.blunders,
    mistakes: a.mistakes,
    inaccuracies: a.inaccuracies,
    coverage: a.coverage,
    accuracy,
    analysedAt: new Date().toISOString(),
  };
}

export default function ChessView({
  config,
  onConfigChange,
  configLoaded,
  showHeader = true,
  analysisCache,
  onAnalysisCached,
}: Props) {
  const [games, setGames] = useState<ChessComGame[]>([]);
  const [analyzed, setAnalyzed] = useState<Map<string, AnalyzedGame>>(new Map());
  const [analysingUrl, setAnalysingUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [selectedOpponent, setSelectedOpponent] = useState<string | null>(null);
  const [fetchMonths, setFetchMonths] = useState(FETCH_MONTHS_STEP);

  const me = config.username.trim();
  const canRun = me.length > 0;

  // Keep selectedOpponent in sync with the opponents list.
  useEffect(() => {
    if (config.opponents.length === 0) {
      setSelectedOpponent(null);
      return;
    }
    if (!selectedOpponent || !config.opponents.some((o) => o.toLowerCase() === selectedOpponent.toLowerCase())) {
      setSelectedOpponent(config.opponents[0]);
    }
  }, [config.opponents, selectedOpponent]);

  const fetchGames = useCallback(async (months: number) => {
    if (!canRun) return;
    setLoading(true);
    setError(null);
    setStatus("Fetching archives…");
    try {
      const archives = await fetchArchives(me);
      if (archives.length === 0) {
        setGames([]);
        setStatus("No games found for that chess.com username.");
        setLoading(false);
        return;
      }
      const urls = recentArchiveUrls(archives, months);
      setStatus(`Fetching ${urls.length} month${urls.length === 1 ? "" : "s"} of games…`);
      const monthly = await Promise.all(urls.map((u) => fetchMonthlyGames(u).catch(() => [])));
      const all = sortGamesNewestFirst(monthly.flat().filter((g) => g.rules === "chess"));
      setGames(all);
      setStatus(
        all.length === 0
          ? `No standard-chess games in the last ${months} months.`
          : `${all.length} game${all.length === 1 ? "" : "s"} in the last ${months} months.`
      );
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [canRun, me]);

  // Auto-run once when config lands and we have a username. Editing the
  // opponents list doesn't re-trigger the fetch -- opponent filtering is
  // done client-side against the cached games array.
  const [autoRan, setAutoRan] = useState(false);
  useEffect(() => {
    if (!configLoaded || autoRan || !canRun) return;
    setAutoRan(true);
    void fetchGames(fetchMonths);
  }, [autoRan, canRun, configLoaded, fetchGames, fetchMonths]);

  // Re-hydrate the analyzed map from the parent-supplied cache whenever the
  // set of games or the cache changes. Games without a cache entry stay
  // un-analyzed until the user clicks "Analyse this game".
  useEffect(() => {
    if (!analysisCache) return;
    const next = new Map<string, AnalyzedGame>();
    for (const g of games) {
      const c = analysisCache[g.url];
      if (c) next.set(g.url, hydrateCached(g, c));
    }
    setAnalyzed(next);
  }, [games, analysisCache]);

  const onAnalyseOne = useCallback(async (g: ChessComGame) => {
    if (analysingUrl) return;
    setAnalysingUrl(g.url);
    try {
      const a = await analyseGame(g, me);
      if (!a) return;
      setAnalyzed((prev) => {
        const next = new Map(prev);
        next.set(g.url, a);
        return next;
      });
      onAnalysisCached?.(g.url, toCached(a));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setAnalysingUrl(null);
    }
  }, [analysingUrl, me, onAnalysisCached]);

  const loadMore = useCallback(() => {
    const next = fetchMonths + FETCH_MONTHS_STEP;
    setFetchMonths(next);
    void fetchGames(next);
  }, [fetchGames, fetchMonths]);

  const meLc = me.toLowerCase();
  const gamesVsSelected = useMemo(() => selectedOpponent
    ? games.filter((g) => {
        const oppLc = selectedOpponent.toLowerCase();
        const w = g.white.username.toLowerCase();
        const b = g.black.username.toLowerCase();
        return (w === meLc && b === oppLc) || (b === meLc && w === oppLc);
      })
    : [], [games, meLc, selectedOpponent]);

  return (
    <div className="space-y-5">
      {showHeader && (
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Chess</h1>
          <p className="text-xs text-muted">
            Track a chess.com user&apos;s recent games. Aggregate stats cover the fetched window. Add opponents
            to unlock per-opponent head-to-head, accuracy, and a move-jumpable review board below.
            Per-game blunder/mistake/inaccuracy analysis runs on demand via the &ldquo;Analyse this game&rdquo;
            button on the review board.
          </p>
        </div>
      )}

      <ConfigPanel
        config={config}
        onChange={onConfigChange}
        onRefresh={() => void fetchGames(fetchMonths)}
        loading={loading}
        canRun={canRun}
      />

      {status && !error && <p className="text-xs text-muted">{status}</p>}
      {error && <p className="text-xs font-medium text-danger">{error}</p>}

      {canRun && games.length > 0 && <AggregateStats games={games} analyzed={analyzed} me={me} />}

      {config.opponents.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Opponent</h2>
            <div className="flex flex-wrap gap-1">
              {config.opponents.map((o) => {
                const active = selectedOpponent?.toLowerCase() === o.toLowerCase();
                return (
                  <button
                    key={o}
                    onClick={() => setSelectedOpponent(o)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      active
                        ? "bg-accent text-accent-contrast"
                        : "bg-surface-2 text-muted hover:bg-surface hover:text-ink"
                    }`}
                    aria-pressed={active}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
          </div>
          {selectedOpponent && (
            <OpponentDetail
              opponent={selectedOpponent}
              games={gamesVsSelected}
              analyzed={analyzed}
              me={me}
              onAnalyse={onAnalyseOne}
              analysingUrl={analysingUrl}
            />
          )}
        </section>
      )}

      {canRun && games.length > 0 && config.opponents.length === 0 && (
        <p className="rounded-lg border border-dashed bg-surface p-4 text-xs text-muted">
          Add an opponent above to see per-opponent stats and the move-jumpable review board.
        </p>
      )}

      {canRun && games.length > 0 && (
        <div className="flex justify-center pt-1">
          <button
            onClick={loadMore}
            disabled={loading}
            className="rounded-full border bg-surface px-3 py-1 text-xs text-muted transition hover:text-ink disabled:opacity-50"
            title={`Extend the fetch window by ${FETCH_MONTHS_STEP} more months`}
          >
            {loading ? "Loading…" : `Load more (${FETCH_MONTHS_STEP} more months)`}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Compact settings strip:
 *   - username shows as text with a pencil-edit affordance (input on click,
 *     save on Enter/blur). Not always-editable so it doesn't read as a
 *     "please type a username" form on every visit.
 *   - opponents live in a `<details>` disclosure — the summary shows the
 *     count, expanding reveals the chip list + add input. Native, no menu
 *     dependency, and matches the pattern already in
 *     admin/pursuit-requests/_client.tsx.
 *   - refresh is an icon-only borderless button.
 */
function ConfigPanel({
  config,
  onChange,
  onRefresh,
  loading,
  canRun,
}: {
  config: ChessConfig;
  onChange: (c: ChessConfig) => void;
  onRefresh: () => void;
  loading: boolean;
  canRun: boolean;
}) {
  const [editingName, setEditingName] = useState(!config.username);
  const [nameDraft, setNameDraft] = useState(config.username);
  const [oppInput, setOppInput] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingName) inputRef.current?.focus();
  }, [editingName]);

  const commitName = () => {
    const v = nameDraft.trim();
    if (v !== config.username) onChange({ ...config, username: v });
    setEditingName(false);
  };
  const addOpponent = () => {
    const name = oppInput.trim();
    if (!name) return;
    if (config.opponents.some((o) => o.toLowerCase() === name.toLowerCase())) {
      setOppInput("");
      return;
    }
    onChange({ ...config, opponents: [...config.opponents, name] });
    setOppInput("");
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-surface px-3 py-2 text-xs">
      <span className="text-muted">chess.com:</span>
      {editingName ? (
        <input
          ref={inputRef}
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitName(); }
            if (e.key === "Escape") { setNameDraft(config.username); setEditingName(false); }
          }}
          onBlur={commitName}
          placeholder="e.g. hikaru"
          className="w-40 rounded border bg-surface px-2 py-0.5 text-xs"
        />
      ) : (
        <>
          <span className="font-semibold text-ink">{config.username || <em className="text-faint">not set</em>}</span>
          <button
            onClick={() => { setNameDraft(config.username); setEditingName(true); }}
            className="text-faint transition hover:text-accent"
            aria-label="Edit chess.com username"
            title="Edit username"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4z" />
            </svg>
          </button>
        </>
      )}

      <span className="mx-1 h-4 w-px bg-border" />

      <details className="text-xs">
        <summary className="cursor-pointer list-none rounded-full bg-surface-2 px-2 py-0.5 text-muted transition hover:text-ink">
          Opponents ({config.opponents.length}) ▾
        </summary>
        <div className="mt-2 flex flex-wrap items-center gap-1 rounded-lg border bg-surface p-2">
          {config.opponents.length === 0 && (
            <span className="text-[11px] text-faint">no opponents yet</span>
          )}
          {config.opponents.map((o) => (
            <span key={o} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px]">
              {o}
              <button
                onClick={() => onChange({ ...config, opponents: config.opponents.filter((x) => x !== o) })}
                aria-label={`Remove ${o}`}
                className="text-faint hover:text-danger"
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={oppInput}
            onChange={(e) => setOppInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addOpponent(); }
            }}
            placeholder="add, ↵"
            className="rounded border bg-surface px-2 py-0.5 text-[11px]"
          />
        </div>
      </details>

      <button
        onClick={onRefresh}
        disabled={!canRun || loading}
        className="ml-auto text-faint transition hover:text-accent disabled:opacity-40"
        aria-label="Refresh games"
        title="Refetch the current window"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={loading ? "animate-spin" : ""}>
          <path d="M23 4v6h-6" /><path d="M20.49 15A9 9 0 116.36 5.64L23 10" />
        </svg>
      </button>
    </div>
  );
}
