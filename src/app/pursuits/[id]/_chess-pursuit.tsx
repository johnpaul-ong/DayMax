"use client";

/**
 * Chess-templated pursuit renderer. Wraps the shared <ChessView> with a
 * pursuit-header (name, description, member count, delete) and persists
 * config to `pursuits.config jsonb` under the row's existing RLS.
 *
 * One-time migration: if the pursuit's DB config is empty and a legacy
 * `daymax-chess-config` sits in localStorage, we copy it in on first mount
 * and remove the localStorage key so subsequent edits don't accidentally
 * fork the two stores.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { deletePursuit, leavePursuit, type Pursuit } from "@/lib/pursuits";
import ChessView, {
  CHESS_DEFAULTS,
  normaliseChessConfig,
  type ChessConfig,
} from "../../chess/_view";

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

interface Props {
  pursuit: Pursuit;
  initialConfig: unknown;
}

export default function ChessPursuit({ pursuit, initialConfig }: Props) {
  const [config, setConfig] = useState<ChessConfig>(() => normaliseChessConfig(initialConfig));
  const [configLoaded, setConfigLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Coalesce writes so typing an opponent name doesn't fire one write per keystroke.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const migratedRef = useRef(false);

  // On first mount: if server-side config is empty AND legacy localStorage exists, adopt + clear it.
  useEffect(() => {
    if (migratedRef.current) return;
    migratedRef.current = true;
    const isEmpty =
      !config.username && config.opponents.length === 0 && config.monthsBack === 1;
    if (!isEmpty) {
      setConfigLoaded(true);
      return;
    }
    const local = readLocalConfig();
    if (local && (local.username || local.opponents.length > 0)) {
      setConfig(local);
      persist(local, /*silent*/ true).then(() => {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {}
      });
    }
    setConfigLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function persist(next: ChessConfig, silent = false) {
    if (!pursuit.isOwner) return; // Non-owners can view but can't edit config.
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

  function onConfigChange(next: ChessConfig) {
    setConfig(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(next), 400);
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{pursuit.name}</h1>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
            chess
          </span>
          <span className="text-sm text-faint">
            {pursuit.memberCount} member{pursuit.memberCount === 1 ? "" : "s"} · by {pursuit.ownerName}
            {pursuit.isOwner && " (you)"}
          </span>
        </div>
        {pursuit.description && (
          <p className="mt-1 text-sm text-muted">{pursuit.description}</p>
        )}
        {!pursuit.isOwner && (
          <p className="mt-2 text-xs text-faint">
            You&apos;re viewing this owner&apos;s chess review. Only the owner can edit the config.
          </p>
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

      <ChessView
        config={config}
        onConfigChange={onConfigChange}
        configLoaded={configLoaded}
        showHeader={false}
      />
    </div>
  );
}
