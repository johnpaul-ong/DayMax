"use client";

/**
 * Inline "type a name, add a friend" widget for the top of /friends.
 * Extracted from page.tsx unchanged so the page can be scanned in one
 * screen.
 */

import { useEffect, useState } from "react";

export function InlineFriendSearch({ onAdded }: { onAdded: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ memberId: string; displayName: string; username: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const query = q.trim().replace(/^@/, "");
    if (query.length < 2) { setResults([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      import("@/lib/friends").then((f) => f.searchProfiles(query))
        .then((rows) => { if (alive) setResults(rows); })
        .catch(() => { if (alive) setResults([]); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  async function add(memberId: string) {
    setBusy(memberId);
    setMsg(null);
    try {
      const { sendFriendRequest } = await import("@/lib/friends");
      await sendFriendRequest(memberId);
      setQ("");
      setResults([]);
      setMsg("Request sent.");
      setTimeout(() => setMsg((m) => (m === "Request sent." ? null : m)), 2000);
      onAdded();
    } catch (e: any) {
      setMsg(String(e.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or @handle…"
        className="w-full rounded-lg border bg-surface px-3 py-2 text-sm"
      />
      {results.length > 0 && (
        <ul className="mt-2 divide-y rounded-lg border bg-surface">
          {results.map((r) => (
            <li key={r.memberId} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                {r.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{r.displayName}</span>
                <span className="ml-1 text-xs text-faint">@{r.username}</span>
              </span>
              <button
                onClick={() => void add(r.memberId)}
                disabled={busy === r.memberId}
                className="btn-primary py-1 text-xs"
              >
                {busy === r.memberId ? "…" : "+ add"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="mt-1 text-xs text-muted">{msg}</p>}
    </div>
  );
}
