"use client";

/**
 * Shared chess pursuit view: config panel + games list + review board.
 *
 * Rendered by both `/chess` (standalone, before it redirects) and
 * `/pursuits/[id]` when `pursuit.template === 'chess'`. All chess-specific UI
 * lives here so the two surfaces stay in sync.
 *
 * The view is purely presentational — it does not decide where the config
 * lives. Parents pass in `config` + `onConfigChange` and choose the backing
 * store (localStorage for the standalone route, `pursuits.config jsonb` for
 * the templated pursuit).
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchArchives,
  fetchMonthlyGames,
  filterGamesVsOpponents,
  recentArchiveUrls,
  sortGamesNewestFirst,
  type AnalyzedGame,
  type ChessComGame,
} from "@/lib/chess";
import { analyseGame } from "@/lib/chessAnalyze";

const GameBoard = dynamic(() => import("./_board"), {
  ssr: false,
  loading: () => <div className="text-xs text-muted">loading board…</div>,
});

export interface ChessConfig {
  username: string;
  opponents: string[];
  monthsBack: number;
}

export const CHESS_DEFAULTS: ChessConfig = { username: "", opponents: [], monthsBack: 1 };

/** Normalise anything a jsonb/localStorage read might return into a valid config. */
export function normaliseChessConfig(raw: unknown): ChessConfig {
  const j = (raw ?? {}) as Record<string, unknown>;
  return {
    username: typeof j.username === "string" ? j.username : "",
    opponents: Array.isArray(j.opponents)
      ? j.opponents.filter((s: unknown): s is string => typeof s === "string")
      : [],
    monthsBack: Number.isFinite(j.monthsBack as number)
      ? Math.max(1, Math.min(6, Math.round(j.monthsBack as number)))
      : 1,
  };
}

interface Props {
  config: ChessConfig;
  onConfigChange: (c: ChessConfig) => void;
  /** Loaded flag — the view won't auto-run its first fetch until parent says config has landed
   *  (so we don't fire a bogus fetch with defaults during a jsonb round-trip). */
  configLoaded: boolean;
  /** Optional title override; parents on /pursuits/[id] already show the pursuit name. */
  showHeader?: boolean;
}

export default function ChessView({ config, onConfigChange, configLoaded, showHeader = true }: Props) {
  const [games, setGames] = useState<ChessComGame[]>([]);
  const [analyzed, setAnalyzed] = useState<Map<string, AnalyzedGame>>(new Map());
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  const canRun = config.username.trim().length > 0 && config.opponents.length > 0;

  const fetchAndAnalyse = useCallback(async () => {
    if (!canRun) return;
    setLoading(true);
    setError(null);
    setStatus("Fetching archives…");
    setGames([]);
    setAnalyzed(new Map());
    setSelectedUrl(null);
    try {
      const archives = await fetchArchives(config.username.trim());
      if (archives.length === 0) {
        setStatus("No games found for that chess.com username.");
        setLoading(false);
        return;
      }
      const urls = recentArchiveUrls(archives, config.monthsBack);
      setStatus(`Fetching ${urls.length} month${urls.length === 1 ? "" : "s"} of games…`);
      const monthly = await Promise.all(urls.map((u) => fetchMonthlyGames(u).catch(() => [])));
      const all = monthly.flat();
      const filtered = sortGamesNewestFirst(filterGamesVsOpponents(all, config.username.trim(), config.opponents));
      setGames(filtered);
      if (filtered.length === 0) {
        setStatus("No games against those opponents in the selected window.");
        setLoading(false);
        return;
      }
      setStatus(`Analysing ${filtered.length} game${filtered.length === 1 ? "" : "s"} via Lichess cloud eval…`);
      const acc = new Map<string, AnalyzedGame>();
      for (const g of filtered) {
        const a = await analyseGame(g, config.username.trim());
        if (a) {
          acc.set(g.url, a);
          setAnalyzed(new Map(acc));
        }
      }
      setStatus(`Done — ${filtered.length} game${filtered.length === 1 ? "" : "s"}.`);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [canRun, config.monthsBack, config.opponents, config.username]);

  // Auto-run once when config is loaded and complete — but only on first mount,
  // so editing the opponents list doesn't fire a fetch storm.
  const [autoRan, setAutoRan] = useState(false);
  useEffect(() => {
    if (!configLoaded || autoRan || !canRun) return;
    setAutoRan(true);
    void fetchAndAnalyse();
  }, [autoRan, canRun, configLoaded, fetchAndAnalyse]);

  const selected = useMemo(() => games.find((g) => g.url === selectedUrl) ?? null, [games, selectedUrl]);
  const selectedAnalyzed = selectedUrl ? analyzed.get(selectedUrl) ?? null : null;

  return (
    <div className="space-y-4">
      {showHeader && (
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Chess</h1>
          <p className="text-xs text-muted">
            Track a chess.com user&apos;s recent games against a set of opponents. Blunder / mistake / inaccuracy tallies come from Lichess&apos; free cloud-eval cache (no engine runs here). Games without cached evals show as &ldquo;eval unavailable&rdquo;.
          </p>
        </div>
      )}

      <ConfigPanel config={config} onChange={onConfigChange} onRun={fetchAndAnalyse} disabled={!canRun || loading} />

      {status && !error && <p className="text-xs text-muted">{status}</p>}
      {error && <p className="text-xs font-medium text-danger">{error}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Games</h2>
          {games.length === 0 && !loading && (
            <p className="text-xs text-faint">No games yet. Set a chess.com username and at least one opponent, then Refresh.</p>
          )}
          <ul className="space-y-2">
            {games.map((g) => {
              const a = analyzed.get(g.url);
              const isSelected = g.url === selectedUrl;
              const me = config.username.trim().toLowerCase();
              const iAmWhite = g.white.username.toLowerCase() === me;
              const opp = iAmWhite ? g.black : g.white;
              const mine = iAmWhite ? g.white : g.black;
              const resultLabel = mine.result === "win" ? "W" : mine.result === "checkmated" || mine.result === "resigned" || mine.result === "timeout" ? "L" : "½";
              return (
                <li key={g.url}>
                  <button
                    onClick={() => setSelectedUrl(g.url)}
                    className={`w-full rounded-lg border p-2 text-left text-xs transition ${isSelected ? "border-accent bg-accent-soft" : "bg-surface hover:border-accent-soft"}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${resultLabel === "W" ? "bg-ok/20 text-ok" : resultLabel === "L" ? "bg-danger/20 text-danger" : "bg-surface-2 text-muted"}`}>{resultLabel}</span>
                      <span className="font-semibold">vs {opp.username}</span>
                      <span className="text-faint">({opp.rating ?? "?"} · {g.timeClass})</span>
                      <span className="ml-auto text-faint tabular-nums">{new Date(g.endTime * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px]">
                      {a?.blunders != null ? (
                        <>
                          <span title="Blunders (>=200cp loss on your move)">?? {a.blunders}</span>
                          <span title="Mistakes (>=100cp)">? {a.mistakes}</span>
                          <span title="Inaccuracies (>=50cp)">?! {a.inaccuracies}</span>
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
          <h2 className="text-sm font-semibold">Board</h2>
          {selected ? (
            <div className="rounded-lg border bg-surface p-2">
              <GameBoard
                pgn={selected.pgn}
                orientation={selectedAnalyzed?.myColour ?? "white"}
                cpLossPerMyMove={selectedAnalyzed?.cpLossPerMove ?? null}
                myColour={selectedAnalyzed?.myColour}
              />
              <a href={selected.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[11px] text-accent hover:underline">Open on chess.com ↗</a>
            </div>
          ) : (
            <p className="text-xs text-faint">Pick a game to review it move by move.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigPanel({
  config,
  onChange,
  onRun,
  disabled,
}: {
  config: ChessConfig;
  onChange: (c: ChessConfig) => void;
  onRun: () => void;
  disabled: boolean;
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
        <label className="text-xs">
          <div className="mb-1 text-muted">Months back</div>
          <input
            type="number"
            min={1}
            max={6}
            value={config.monthsBack}
            onChange={(e) => onChange({ ...config, monthsBack: Math.max(1, Math.min(6, Number(e.target.value) || 1)) })}
            className="w-16 rounded-lg border bg-surface px-2 py-1 text-sm"
          />
        </label>
        <button onClick={onRun} disabled={disabled} className="btn-primary py-1 text-sm">Refresh</button>
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
              if (e.key === "Enter") { e.preventDefault(); addOpponent(); }
            }}
            placeholder="add an opponent, ↵"
            className="rounded-lg border bg-surface px-2 py-1 text-xs"
          />
          <button onClick={addOpponent} className="btn-ghost py-1 text-xs">Add</button>
        </div>
      </div>
    </div>
  );
}
