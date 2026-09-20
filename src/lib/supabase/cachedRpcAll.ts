"use client";

/**
 * Short-lived cache in front of rpcAll(): the same page can call three
 * views that all read the same underlying board (Arena, Life pursuit,
 * a profile page's year strip), and without a cache each read costs a
 * fresh ~200k-row aggregate on the server. 60 seconds is long enough
 * to make hopping between pages instant, short enough that a value
 * someone just logged shows up on their next refresh.
 *
 * A single Map instance lives in this module and is shared across
 * every caller — that matters, because otherwise
 * invalidateCommunityCache() from one caller wouldn't clear a hit that
 * another caller inserted.
 */

import { createClient } from "@/lib/supabase/client";
import { rpcAll } from "./rpcAll";

const rpcCache = new Map<string, { at: number; rows: Promise<any[]> }>();
const CACHE_MS = 60_000;

export function cachedRpcAll(fn: string, params: Record<string, unknown>): Promise<any[]> {
  const key = `${fn}:${JSON.stringify(params)}`;
  const hit = rpcCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const rows = rpcAll(fn, params).catch((e) => {
    rpcCache.delete(key); // don't cache failures
    throw e;
  });
  rpcCache.set(key, { at: Date.now(), rows });
  return rows;
}

/** Clear the community caches — call after logging something that should show up. */
export function invalidateCommunityCache(): void {
  rpcCache.clear();
}

// Also clear on sign-out so the next user on the same tab doesn't
// inherit the previous user's leaderboard rows. Guarded to run once
// in the browser only.
if (typeof window !== "undefined") {
  try {
    createClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") invalidateCommunityCache();
    });
  } catch { /* SSR safety */ }
}
