"use client";

/**
 * Search: one box for people and pursuits.
 * People appear only if they turned on discovery (minors never do).
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { listFriends, searchProfiles, sendFriendRequest, type FoundProfile, type Friendship } from "@/lib/friends";
import { fetchDirectory, joinPursuit, type Pursuit } from "@/lib/pursuits";
import { pursuitHref } from "../pursuits/page";

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<FoundProfile[]>([]);
  const [pursuits, setPursuits] = useState<Pursuit[]>([]);
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    listFriends().then(setFriends).catch(() => {});
    fetchDirectory().then(setPursuits).catch(() => {});
  }, []);

  const friendIds = useMemo(() => new Set(friends.map((f) => f.memberId)), [friends]);
  const matchingPursuits = useMemo(
    () =>
      q.trim()
        ? pursuits.filter(
            (p) => p.name.toLowerCase().includes(q.trim().toLowerCase()) || p.description.toLowerCase().includes(q.trim().toLowerCase())
          )
        : [],
    [pursuits, q]
  );

  async function search() {
    if (!q.trim()) return;
    setBusy(true);
    setMsg(null);
    setSearched(true);
    try {
      setPeople(await searchProfiles(q.trim()));
    } catch (e: any) {
      setMsg(String(e.message ?? e).includes("does not exist") ? "Search needs migration 0012 — run it in the Supabase SQL Editor." : String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-bold">Search</h1>
      <p className="mb-4 text-sm text-muted">Find people to add or pursuits to join. People show up only if they turned on discovery in Settings.</p>
      <div className="mb-4 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
          placeholder="People or pursuits…"
          className="flex-1 rounded-lg border bg-surface px-3 py-2 text-sm"
          autoFocus
        />
        <button onClick={() => void search()} disabled={busy || !q.trim()} className="btn-primary">{busy ? "…" : "Search"}</button>
      </div>
      {msg && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{msg}</p>}

      {searched && (
        <div className="mb-6">
          <h2 className="mb-1 font-semibold">People</h2>
          {people.length === 0 ? (
            <p className="card p-3 text-sm text-faint">Nobody found — they may not be discoverable. Send them an invite link from Friends instead.</p>
          ) : (
            <div className="card divide-y">
              {people.map((r) => (
                <div key={r.memberId} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <span className="font-medium">{r.displayName}</span>
                  <span className="text-xs text-faint">@{r.username}</span>
                  {friendIds.has(r.memberId) ? (
                    <Link href={`/friends/${r.memberId}`} className="ml-auto text-xs font-medium text-accent hover:underline">view profile</Link>
                  ) : (
                    <button
                      onClick={() =>
                        void sendFriendRequest(r.memberId)
                          .then(() => setMsg(`Request sent to ${r.displayName}.`))
                          .catch((e) => setMsg(String(e.message ?? e)))
                      }
                      className="ml-auto rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-accent-contrast"
                    >
                      Add friend
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {q.trim() && (
        <div>
          <h2 className="mb-1 font-semibold">Pursuits</h2>
          {matchingPursuits.length === 0 ? (
            <p className="card p-3 text-sm text-faint">No pursuits match — <Link href="/pursuits" className="font-medium text-accent hover:underline">start one yourself</Link>.</p>
          ) : (
            <div className="card divide-y">
              {matchingPursuits.map((p) => (
                <div key={p.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <Link href={pursuitHref(p)} className="font-medium hover:text-accent hover:underline">{p.name}</Link>
                  <span className="text-xs text-faint">by {p.ownerName} · {p.memberCount} member{p.memberCount === 1 ? "" : "s"}</span>
                  {!p.isMember && p.kind !== "life" && (
                    <button
                      onClick={() => void joinPursuit(p.id).then(() => setMsg(`Joined ${p.name}.`)).catch((e) => setMsg(String(e.message ?? e)))}
                      className="ml-auto rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-accent-contrast"
                    >
                      Join
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
