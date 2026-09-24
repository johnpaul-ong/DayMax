"use client";

/**
 * Chess entry point.
 *
 * The chess UI itself lives in `./_view.tsx` — this route is now a thin
 * redirector so `/chess` and `/pursuits/[id]` (when template='chess') render
 * the same thing.
 *
 * Behaviour:
 *   1. If the signed-in user owns a pursuit with template='chess', redirect
 *      to `/pursuits/{id}`. That's the canonical location.
 *   2. Otherwise fall back to the standalone view backed by localStorage —
 *      so nothing regresses for a user who bookmarked /chess, and so someone
 *      trying it out first can commit to the pursuit-templated version
 *      afterwards. A hint at the top explains the recommended path.
 *
 * The one-time migration of localStorage config into pursuits.config happens
 * inside `/pursuits/[id]/page.tsx` when the pursuit's config is empty and a
 * localStorage config exists.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ChessView, { CHESS_DEFAULTS, normaliseChessConfig, type ChessConfig } from "./_view";

const STORAGE_KEY = "daymax-chess-config";

function loadLocalConfig(): ChessConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return CHESS_DEFAULTS;
    return normaliseChessConfig(JSON.parse(raw));
  } catch {
    return CHESS_DEFAULTS;
  }
}

function saveLocalConfig(c: ChessConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {}
}

export default function ChessPage() {
  const router = useRouter();
  const [state, setState] = useState<
    | { kind: "checking" }
    | { kind: "standalone"; config: ChessConfig }
    | { kind: "redirecting" }
  >({ kind: "checking" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          // Middleware normally intercepts this; if it doesn't (e.g. dev),
          // just render standalone.
          if (alive) setState({ kind: "standalone", config: loadLocalConfig() });
          return;
        }
        const { data: rows } = await supabase
          .from("pursuits")
          .select("id")
          .eq("owner_id", userData.user.id)
          .eq("template", "chess")
          .limit(1);
        if (!alive) return;
        const hit = rows?.[0];
        if (hit) {
          setState({ kind: "redirecting" });
          router.replace(`/pursuits/${hit.id}`);
        } else {
          setState({ kind: "standalone", config: loadLocalConfig() });
        }
      } catch {
        if (alive) setState({ kind: "standalone", config: loadLocalConfig() });
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  if (state.kind === "checking" || state.kind === "redirecting") {
    return (
      <div className="mx-auto max-w-5xl p-3">
        <p className="text-xs text-muted">Loading chess…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-3 space-y-4">
      <div className="rounded-lg border border-accent-soft bg-accent-soft/40 p-3 text-xs">
        Heads up — this standalone page is now the fallback view. Prefer creating (or converting)
        a Pursuit to <b>Chess</b> so it shares the Pursuits home, description, and members.{" "}
        <Link href="/pursuits" className="text-accent hover:underline">Go to Pursuits →</Link>
      </div>
      <ChessView
        config={state.config}
        onConfigChange={(c) => {
          setState({ kind: "standalone", config: c });
          saveLocalConfig(c);
        }}
        configLoaded
      />
    </div>
  );
}
