"use client";

/** Shared social components: friend requests/list + one-click invite link. */

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  acceptFriendRequest,
  createInvite,
  createTrack,
  fetchTracks,
  listFriends,
  removeFriendship,
  type Friendship,
  type Track,
} from "@/lib/friends";

/** People: search for friends, handle requests, manage your friend list. */
export function PeopleSection() {
  const [friends, setFriends] = useState<Friendship[]>([]);

  function reload() {
    listFriends().then(setFriends).catch(() => {});
  }
  useEffect(reload, []);

  const incoming = friends.filter((f) => f.status === "pending" && f.direction === "incoming");
  const outgoing = friends.filter((f) => f.status === "pending" && f.direction === "outgoing");
  const accepted = friends.filter((f) => f.status === "accepted");

  return (
    <div className="mb-6 card p-4">
      <h2 className="mb-1 font-semibold">People</h2>
      <p className="mb-3 text-sm text-muted">
        Friend requests and your friend list.
      </p>
      <p className="mb-3 text-sm">
        <Link href="/search" className="font-medium text-accent hover:underline">Search for people and pursuits →</Link>
      </p>
      {incoming.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <h3 className="mb-1 text-sm font-semibold">Requests for you</h3>
          {incoming.map((f) => (
            <div key={f.friendshipId} className="flex items-center gap-2 py-1 text-sm">
              <span className="font-medium">{f.displayName}</span>
              <span className="text-xs text-faint">@{f.username}</span>
              <button onClick={() => void acceptFriendRequest(f.friendshipId).then(reload)} className="ml-auto rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-accent-contrast">
                Accept
              </button>
              <button onClick={() => void removeFriendship(f.friendshipId).then(reload)} className="rounded-lg border px-3 py-1 text-xs">
                Decline
              </button>
            </div>
          ))}
        </div>
      )}

      {(accepted.length > 0 || outgoing.length > 0) && (
        <div className="mt-3 border-t pt-2">
          <h3 className="mb-1 text-sm font-semibold">Your friends</h3>
          {accepted.map((f) => (
            <div key={f.friendshipId} className="flex items-center gap-2 py-1 text-sm">
              <Link href={`/friends/${f.memberId}`} className="font-medium hover:text-accent hover:underline">
                {f.displayName}
              </Link>
              <span className="text-xs text-faint">@{f.username}</span>
              <button onClick={() => void removeFriendship(f.friendshipId).then(reload)} className="ml-auto text-xs text-danger hover:opacity-70">
                remove
              </button>
            </div>
          ))}
          {outgoing.map((f) => (
            <div key={f.friendshipId} className="flex items-center gap-2 py-1 text-sm opacity-60">
              <span className="font-medium">{f.displayName}</span>
              <span className="text-xs text-faint">@{f.username} · request sent</span>
              <button onClick={() => void removeFriendship(f.friendshipId).then(reload)} className="ml-auto text-xs text-danger hover:opacity-70">
                cancel
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One-click friend adding: makes sure you own a track, mints a link, copies it. */
export function AddFriendCard({ tracks, me, onChanged }: { tracks: Track[]; me: string | null; onChanged: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function addFriend() {
    if (!me) return;
    setBusy(true);
    setErr(null);
    try {
      let track = tracks.find((t) => !t.isDemo && t.ownerId === me && t.kind === "day");
      if (!track) {
        await createTrack("My Crew", "day");
        onChanged();
        const fresh = await fetchTracks();
        track = fresh.find((t) => !t.isDemo && t.ownerId === me && t.kind === "day");
      }
      if (!track) throw new Error("Could not create a track");
      const invite = await createInvite(track.id, null);
      const url = `${location.origin}/join/${invite.token}`;
      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      } catch {}
      // native share sheet on phones
      if (navigator.share) {
        navigator.share({ title: "Join me on DayMax", text: "Track your days with me on DayMax:", url }).catch(() => {});
      }
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 card border-2 border-accent-soft p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="font-semibold">Add a friend</h2>
          <p className="text-sm text-muted">One tap: get a link, send it however you like.</p>
        </div>
        <button onClick={() => void addFriend()} disabled={busy || !me} className="btn-primary">
          {busy ? "Making link…" : "Get invite link"}
        </button>
      </div>
      {err && <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      {link && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
          <code className="max-w-full flex-1 truncate">{link}</code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
            className="font-medium text-accent hover:underline"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
