"use client";

/**
 * Friends: your tracks, who's in them, your share rule, invite links,
 * and Compare — the leaderboard. Compare shows totals and focus score
 * only; raw labels are never shown unless that member chose raw_labels.
 *
 * Every substantial piece of UI has been extracted into a sibling file:
 *
 *   _search.tsx     the inline "type a name, add a friend" widget
 *   _track.tsx      track header + expanded detail + Board + Comments
 *   _compare.tsx    the day-grid and lifts Compare panels
 *
 * This page owns the top-level list only (friend requests + friend
 * chips + track cards).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  acceptFriendRequest,
  fetchTracks,
  listFriends,
  removeFriendship,
  type Friendship,
  type Track,
} from "@/lib/friends";
import { friendlyBackendError } from "@/lib/friendlyError";
import { createClient } from "@/lib/supabase/client";
import { InlineFriendSearch } from "./_search";
import { TrackDetail, TrackHeader } from "./_track";

export default function FriendsPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [allFriendships, setAllFriendships] = useState<Friendship[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function reload() {
    fetchTracks()
      .then((ts) => {
        setTracks(ts);
        // Tracks now start COLLAPSED by default -- the old auto-open
        // of ts[0] made a page of 3+ tracks feel like a wall of
        // dropdown-charts as soon as you landed. Tap a track to open it.
      })
      .catch((e) =>
        setError(
          String(e.message ?? e).includes("does not exist") || String(e.message ?? e).includes("schema cache")
            ? friendlyBackendError(e, "Friends")
            : String(e.message ?? e)
        )
      )
      .finally(() => setLoading(false));
    listFriends().then(setAllFriendships).catch(() => {});
  }

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    reload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const incoming = allFriendships.filter((f) => f.status === "pending" && f.direction === "incoming");
  const outgoing = allFriendships.filter((f) => f.status === "pending" && f.direction === "outgoing");
  const friends = allFriendships.filter((f) => f.status === "accepted");

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-xl font-bold">Friends</h1>
      <p className="mb-4 text-sm text-muted">
        Invite-only tracks. Compare uses totals and focus score — never your labels, unless a member explicitly shares them.
        Looking to add someone? Head to <Link href="/search" className="font-medium text-accent hover:underline">Search</Link>.
      </p>
      {error && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>}

      {incoming.length > 0 && (
        <div className="mb-6 card border-2 border-accent-soft p-4">
          <h2 className="mb-2 font-semibold">
            Friend requests <span className="ml-1 rounded-full bg-accent px-2 py-0.5 text-xs text-accent-contrast">{incoming.length}</span>
          </h2>
          {incoming.map((f) => (
            <div key={f.friendshipId} className="flex flex-wrap items-center gap-2 border-t py-2 text-sm first:border-t-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                {f.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="font-medium">{f.displayName}</span>
              <span className="text-xs text-faint">@{f.username}</span>
              <button
                onClick={() => void acceptFriendRequest(f.friendshipId).then(reload).catch((e) => setError(String(e.message ?? e)))}
                className="ml-auto rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-accent-contrast"
              >
                Accept
              </button>
              <button onClick={() => void removeFriendship(f.friendshipId).then(reload)} className="rounded-lg border px-3 py-1 text-xs">
                Decline
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mb-6">
        <div className="mb-1.5 flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-muted">Your friends</h2>
        </div>

        {/* Inline @-search: adding someone was one hop away via
            /search and easy to miss. Type an @handle or name, tap
            + to send the request without leaving the page. */}
        <InlineFriendSearch onAdded={reload} />

        {friends.length === 0 ? (
          <p className="card p-3 text-sm text-faint">
            No friends yet — <Link href="/search" className="font-medium text-accent hover:underline">search for people</Link> by name or @handle.
          </p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {friends.map((f) => (
              <Link
                key={f.friendshipId}
                href={`/friends/${f.memberId}`}
                className="flex shrink-0 flex-col items-center gap-1 rounded-xl border bg-surface px-3 py-2 transition hover:-translate-y-0.5 hover:text-accent"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">
                  {f.displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-[6rem] truncate text-xs font-medium">{f.displayName}</span>
                <span className="max-w-[6rem] truncate text-[10px] text-faint">@{f.username}</span>
              </Link>
            ))}
          </div>
        )}
        {outgoing.length > 0 && (
          <p className="mt-2 text-xs text-faint">
            Waiting on {outgoing.map((f) => `@${f.username}`).join(", ")} to accept.
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : tracks.length === 0 && !error ? (
        <p className="card p-4 text-sm text-faint">No tracks yet — add a friend from Search and a track is set up for you automatically.</p>
      ) : (
        <div>
          <h2 className="mb-1.5 text-sm font-semibold text-muted">Tracks</h2>
          <div className="space-y-4">
            {tracks.map((t) => (
              <div key={t.id} className="card p-4">
                <TrackHeader
                  track={t}
                  isOwner={t.ownerId === me}
                  open={open === t.id}
                  onToggle={() => setOpen(open === t.id ? null : t.id)}
                  onRenamed={reload}
                />
                {open === t.id && me && <TrackDetail track={t} me={me} onDeleted={reload} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
