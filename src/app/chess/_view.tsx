"use client";

/**
 * Shared chess pursuit view. Composes three sections:
 *
 *   1. ConfigPanel        — username + opponents management (persisted upstream)
 *   2. AggregateStats     — snapshot + charts across ALL games in the window
 *   3. OpponentDetail     — per-selected-opponent stats + games + review board
 *
 * Rendered by both `/chess` (standalone, before the redirect fires) and
 * `/pursuits/[id]` (the templated Chess pursuit). Both surfaces stay in sync
 * because all chess-specific UI lives here.
 *
 * Fetch window is HARDCODED to the last 6 months. This is easy to raise: bump
 * FETCH_MONTHS below. The previous "months back" input was removed on
 * feedback -- it was clutter, and 6 months hits chess.com's per-month archive
 * endpoint six times, which is well within polite-usage limits.
 */

import { useCallback, useEffect, useState } from "react";
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

const FETCH_MONTHS = 6;

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

interface Props {
  config: ChessConfig;
  onConfigChange: (c: ChessConfig) => void;
  configLoaded: boolean;
  showHeader?: boolean;
}

export default function ChessView({ config, onConfigChange, configLoaded, showHeader = true }: Props) {
  // Cache ALL fetched games in the window, not just the ones vs. current
  // opponents -- the aggregate section wants everything, and per-opponent
  // filtering is cheap once the games are in memory.
  const [games, setGames] = useState<ChessComGame[]>([]);
  const [analyzed, setAnalyzed] = useState<Map<string, AnalyzedGame>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [selectedOpponent, setSelectedOpponent] = useState<string | null>(null);

  const me = config.username.trim();
  const canRun = me.length > 0;

  // Keep selectedOpponent in sync with the opponents list -- default to the
  // first entry if the current selection was removed (or never set).
  useEffect(() => {
    if (config.opponents.length === 0) {
      setSelectedOpponent(null);
      return;
    }
    if (!selectedOpponent || !config.opponents.some((o) => o.toLowerCase() === selectedOpponent.toLowerCase())) {
      setSelectedOpponent(config.opponents[0]);
    }
  }, [config.opponents, selectedOpponent]);

  const fetchAndAnalyse = useCallback(async () => {
    if (!canRun) return;
    setLoading(true);
    setError(null);
    setStatus("Fetching archives…");
    setGames([]);
    setAnalyzed(new Map());
    try {
      const archives = await fetchArchives(me);
      if (archives.length === 0) {
        setStatus("No games found for that chess.com username.");
        setLoading(false);
        return;
      }
      const urls = recentArchiveUrls(archives, FETCH_MONTHS);
      setStatus(`Fetching ${urls.length} month${urls.length === 1 ? "" : "s"} of games…`);
      const monthly = await Promise.all(urls.map((u) => fetchMonthlyGames(u).catch(() => [])));
      // Standard chess only -- filter here so aggregate stats aren't polluted
      // by chess960/bughouse/etc. Sort newest-first for the games list and so
      // per-format "current rating" reads the latest game per format.
      const all = sortGamesNewestFirst(monthly.flat().filter((g) => g.rules === "chess"));
      setGames(all);
      if (all.length === 0) {
        setStatus("No standard-chess games in the last 6 months.");
        setLoading(false);
        return;
      }
      setStatus(`Analysing ${all.length} game${all.length === 1 ? "" : "s"} via Lichess cloud eval…`);
      // Analyse only games where the selected user played -- fetchArchives
      // returns their games, so this is a no-op filter today, but keeps the
      // per-game analyseGame call defensive if the endpoint ever returns a
      // spectator record.
      const acc = new Map<string, AnalyzedGame>();
      for (const g of all) {
        const a = await analyseGame(g, me);
        if (a) {
          acc.set(g.url, a);
          setAnalyzed(new Map(acc));
        }
      }
      setStatus(`Done — ${all.length} game${all.length === 1 ? "" : "s"}.`);
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
    void fetchAndAnalyse();
  }, [autoRan, canRun, configLoaded, fetchAndAnalyse]);

  const meLc = me.toLowerCase();
  const gamesVsSelected = selectedOpponent
    ? games.filter((g) => {
        const oppLc = selectedOpponent.toLowerCase();
        const w = g.white.username.toLowerCase();
        const b = g.black.username.toLowerCase();
        return (w === meLc && b === oppLc) || (b === meLc && w === oppLc);
      })
    : [];

  return (
    <div className="space-y-5">
      {showHeader && (
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Chess</h1>
          <p className="text-xs text-muted">
            Track a chess.com user&apos;s recent games. Aggregate stats cover the last 6 months. Add opponents
            to unlock per-opponent head-to-head, accuracy, and a move-jumpable review board below. Blunder /
            mistake / inaccuracy tallies come from Lichess&apos; free cloud-eval cache (no engine runs here);
            games without cached evals show as &ldquo;eval unavailable&rdquo;.
          </p>
        </div>
      )}

      <ConfigPanel
        config={config}
        onChange={onConfigChange}
        onRefresh={fetchAndAnalyse}
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
            />
          )}
        </section>
      )}

      {canRun && games.length > 0 && config.opponents.length === 0 && (
        <p className="rounded-lg border border-dashed bg-surface p-4 text-xs text-muted">
          Add an opponent above to see per-opponent stats and the move-jumpable review board.
        </p>
      )}
    </div>
  );
}

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
  const [oppInput, setOppInput] = useState("");
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
    <div className="rounded-lg border bg-surface p-3 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <div className="mb-1 text-muted">Your chess.com username</div>
          <input
            value={config.username}
            onChange={(e) => onChange({ ...config, username: e.target.value })}
            placeholder="e.g. hikaru"
            className="w-52 rounded-lg border bg-surface px-2 py-1 text-sm"
          />
        </label>
        <button
          onClick={onRefresh}
          disabled={!canRun || loading}
          className="ml-auto rounded-lg border bg-surface px-2 py-1 text-xs text-muted transition hover:text-ink disabled:opacity-50"
          aria-label="Refresh games"
          title="Refetch the last 6 months of games"
        >
          {loading ? "⟳ refreshing…" : "⟳ refresh"}
        </button>
      </div>
      <div>
        <div className="mb-1 text-xs text-muted">Opponents (chess.com usernames)</div>
        <div className="flex flex-wrap items-center gap-1">
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
              if (e.key === "Enter") {
                e.preventDefault();
                addOpponent();
              }
            }}
            placeholder="add an opponent, ↵"
            className="rounded-lg border bg-surface px-2 py-1 text-xs"
          />
          <button onClick={addOpponent} className="btn-ghost py-1 text-xs">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
