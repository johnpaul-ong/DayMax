"use client";

/**
 * Chess-templated pursuit renderer.
 *
 * TWO TABS:
 *   1. "Pursuit overview" (default) — averages across ALL pursuit members
 *      who have set a chess.com username in their own `pursuit_members.config`.
 *      See `_pursuit-overview.tsx`.
 *   2. "My data" — the current per-member view (aggregate + per-opponent
 *      + move-jumpable board).
 *
 * Per-member config lives in `pursuit_members.config` (jsonb, migration 46)
 * under `.chess.{ username, cache }`. That gives every member their own
 * chess.com identity + a local cache of the Lichess analysis (per game URL),
 * so re-visits don't re-analyse anything. The pursuit-wide chess config on
 * `pursuits.config` is still consulted as a fallback for the current user's
 * username so existing rows (converted before migration 46) keep working —
 * once a user edits their username here, it's written to their own
 * pursuit_members row rather than the shared pursuits row.
 *
 * Legacy localStorage `daymax-chess-config` migration lives here too so a
 * user who set up chess pre-pursuit doesn't have to retype.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { deletePursuit, leavePursuit, type Pursuit } from "@/lib/pursuits";
import ChessView, {
  normaliseChessConfig,
  type CachedAnalysis,
  type ChessConfig,
} from "../../chess/_view";
import PursuitOverview from "./_pursuit-overview";

const STORAGE_KEY = "daymax-chess-config";

function readLocalConfig(): ChessConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normaliseChessConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

type MemberChessConfig = {
  chess?: {
    username?: string;
    cache?: Record<string, CachedAnalysis>;
  };
};

interface Props {
  pursuit: Pursuit;
  initialConfig: unknown; // pursuit-wide config (used only as username fallback)
}

export default function ChessPursuit({ pursuit, initialConfig }: Props) {
  // Pursuit-wide opponents list — still on pursuits.config (owner sets it).
  const [config, setConfig] = useState<ChessConfig>(() => normaliseChessConfig(initialConfig));
  const [configLoaded, setConfigLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [analysisCache, setAnalysisCache] = useState<Record<string, CachedAnalysis>>({});
  const [tab, setTab] = useState<"overview" | "mine">("overview");
  const [userId, setUserId] = useState<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef<Record<string, CachedAnalysis>>({});
  const migratedRef = useRef(false);

  // Load the CURRENT user's pursuit_members.config row: username override +
  // analysis cache. Falls back to the pursuit-wide config for username so
  // existing installs (converted before migration 46) keep working.
  useEffect(() => {
    if (migratedRef.current) return;
    migratedRef.current = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id ?? null;
        setUserId(uid);
        if (!uid) { setConfigLoaded(true); return; }

        const { data: memberRow } = await supabase
          .from("pursuit_members")
          .select("config")
          .eq("pursuit_id", pursuit.id)
          .eq("user_id", uid)
          .maybeSingle();
        const memberConfig: MemberChessConfig = (memberRow?.config ?? {}) as MemberChessConfig;
        const memberChess = memberConfig.chess ?? {};

        if (memberChess.cache) {
          cacheRef.current = memberChess.cache;
          setAnalysisCache(memberChess.cache);
        }

        const base = normaliseChessConfig(initialConfig);
        const local = base.username || base.opponents.length ? null : readLocalConfig();
        const merged: ChessConfig = {
          username: memberChess.username ?? local?.username ?? base.username,
          opponents: base.opponents.length ? base.opponents : local?.opponents ?? [],
        };
        setConfig(merged);

        // Legacy localStorage rescue.
        if (local && !memberChess.username && !base.username && local.username) {
          void persistMemberChess({ username: local.username });
          try { localStorage.removeItem(STORAGE_KEY); } catch {}
        }
      } catch {
        // fall through; ChessView will just show the empty username edit input.
      } finally {
        setConfigLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pursuit.id]);

  // Persist pursuit-wide config (opponents list, and the pre-46-fallback
  // username so non-owners can still see something).
  async function persistPursuitConfig(next: ChessConfig, silent = false) {
    if (!pursuit.isOwner) return;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("pursuits")
        .update({ config: next })
        .eq("id", pursuit.id);
      if (error) throw error;
      if (!silent) setSaveError(null);
    } catch (e: any) {
      if (!silent) setSaveError(String(e?.message ?? e));
    }
  }

  // Persist THIS user's own pursuit_members.config.chess subtree. RLS-safe:
  // each member can only update their own row (see migration 13's
  // `edit own membership` policy).
  async function persistMemberChess(patch: Partial<{ username: string; cache: Record<string, CachedAnalysis> }>) {
    if (!userId) return;
    try {
      const supabase = createClient();
      const { data: cur } = await supabase
        .from("pursuit_members")
        .select("config")
        .eq("pursuit_id", pursuit.id)
        .eq("user_id", userId)
        .maybeSingle();
      const existing: MemberChessConfig = (cur?.config ?? {}) as MemberChessConfig;
      const nextChess = { ...(existing.chess ?? {}), ...patch };
      const nextConfig = { ...existing, chess: nextChess };
      const { error } = await supabase
        .from("pursuit_members")
        .update({ config: nextConfig })
        .eq("pursuit_id", pursuit.id)
        .eq("user_id", userId);
      if (error) throw error;
      setSaveError(null);
    } catch (e: any) {
      setSaveError(String(e?.message ?? e));
    }
  }

  function onConfigChange(next: ChessConfig) {
    setConfig(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      // Owner: sync opponents to pursuit-wide config so members see the same list.
      // Username: always persisted to the CURRENT user's own pursuit_members row.
      void persistPursuitConfig(next);
      if (next.username !== (config.username ?? "")) {
        void persistMemberChess({ username: next.username });
      }
    }, 400);
  }

  const onAnalysisCached = useCallback((gameUrl: string, entry: CachedAnalysis) => {
    cacheRef.current = { ...cacheRef.current, [gameUrl]: entry };
    setAnalysisCache(cacheRef.current);
    if (cacheSaveTimer.current) clearTimeout(cacheSaveTimer.current);
    // Debounce so rapid clicks (or a burst of first-time analyses) don't
    // fire one write per game; each write reads-modifies-writes the whole
    // member row's config jsonb.
    cacheSaveTimer.current = setTimeout(() => {
      void persistMemberChess({ cache: cacheRef.current });
    }, 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, pursuit.id]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (cacheSaveTimer.current) clearTimeout(cacheSaveTimer.current);
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{pursuit.name}</h1>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">chess</span>
          <span className="text-sm text-faint">
            {pursuit.memberCount} member{pursuit.memberCount === 1 ? "" : "s"} · by {pursuit.ownerName}
            {pursuit.isOwner && " (you)"}
          </span>
        </div>
        {pursuit.description && (
          <p className="mt-1 text-sm text-muted">{pursuit.description}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link href="/pursuits" className="btn-ghost py-1">← All pursuits</Link>
          {pursuit.isMember && !pursuit.isOwner && (
            <button
              onClick={() => void leavePursuit(pursuit.id).then(() => (location.href = "/pursuits"))}
              className="btn-ghost py-1"
            >
              Leave
            </button>
          )}
          {pursuit.isOwner && (
            <button
              onClick={() => {
                if (confirm(`Delete "${pursuit.name}"?`))
                  void deletePursuit(pursuit.id).then(() => (location.href = "/pursuits"));
              }}
              className="rounded-xl border px-4 py-1 text-sm text-danger"
            >
              Delete
            </button>
          )}
        </div>
        {saveError && (
          <p className="mt-2 text-xs font-medium text-danger">Config save failed: {saveError}</p>
        )}
      </div>

      {/* Two-tab UX matching the community/mine pattern in pursuits/[id]/page.tsx. */}
      <div className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
        {(["overview", "mine"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`flex-1 rounded-lg px-3 py-2.5 ${tab === v ? "bg-surface font-semibold" : "text-muted"}`}
          >
            {v === "overview" ? "Pursuit overview" : "My data"}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <PursuitOverview pursuitId={pursuit.id} pursuitMemberCount={pursuit.memberCount} />
      ) : (
        <ChessView
          config={config}
          onConfigChange={onConfigChange}
          configLoaded={configLoaded}
          showHeader={false}
          analysisCache={analysisCache}
          onAnalysisCached={onAnalysisCached}
        />
      )}
    </div>
  );
}
