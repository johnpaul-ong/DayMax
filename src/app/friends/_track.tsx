"use client";

/**
 * Everything below a Friends-page track row: the track title header
 * with inline rename, the expanded detail (members + share-rule +
 * invites), and the message Board with its Comments panel.
 *
 * Extracted from page.tsx unchanged.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  addTrackMember,
  createInvite,
  deleteInvite,
  deleteTrack,
  fetchInvites,
  fetchMembers,
  listFriends,
  removeMember,
  renameTrack,
  setMyShareRule,
  type Friendship,
  type Invite,
  type ShareRule,
  type Track,
  type TrackMember,
} from "@/lib/friends";
import {
  addComment,
  createPost,
  deleteComment,
  deletePost,
  fetchBoard,
  fetchComments,
  setBoardEnabled,
  timeAgo,
  type BoardPost,
  type PostComment,
  type PostVisibility,
} from "@/lib/board";
import { DayCompare, LiftsCompare } from "./_compare";

const RULE_INFO: Record<ShareRule, string> = {
  hidden: "You are invisible on Compare.",
  totals_only: "Friends see your bucket totals and focus score, never labels.",
  raw_labels: "Friends can also open your day detail with labels. Most people should not pick this.",
};

/** Track title row: expand/collapse, plus inline rename for the owner. */
export function TrackHeader({
  track,
  isOwner,
  open,
  onToggle,
  onRenamed,
}: {
  track: Track;
  isOwner: boolean;
  open: boolean;
  onToggle: () => void;
  onRenamed: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(track.name);
  const [err, setErr] = useState<string | null>(null);

  function save() {
    if (!name.trim() || name.trim() === track.name) return setEditing(false);
    renameTrack(track.id, name.trim())
      .then(() => {
        setEditing(false);
        onRenamed();
      })
      .catch((e) => setErr(String(e.message ?? e)));
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setName(track.name);
              setEditing(false);
            }
          }}
          autoFocus
          className="w-56 rounded-lg border bg-surface px-2 py-1.5 text-sm font-semibold"
        />
        <button onClick={save} className="btn-primary py-1">Save</button>
        <button onClick={() => { setName(track.name); setEditing(false); }} className="btn-ghost py-1">Cancel</button>
        {err && <span className="text-xs text-danger">{err}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button onClick={onToggle} className="flex min-w-0 flex-1 items-center justify-between text-left">
        <span className="min-w-0 font-semibold">
          <span className="truncate">{track.name}</span>
          <span className="ml-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-normal text-muted">{track.kind}</span>
          {track.isDemo && <span className="ml-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">demo</span>}
        </span>
        <span className="ml-2 text-sm text-faint">{open ? "▲" : "▼"}</span>
      </button>
      {isOwner && !track.isDemo && (
        <button onClick={() => setEditing(true)} className="shrink-0 text-xs font-medium text-accent hover:underline">
          rename
        </button>
      )}
    </div>
  );
}

export function TrackDetail({ track, me, onDeleted }: { track: Track; me: string; onDeleted: () => void }) {
  const [members, setMembers] = useState<TrackMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [showInvites, setShowInvites] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const isOwner = track.ownerId === me;

  function reload() {
    fetchMembers(track.id).then(setMembers).catch((e) => setErr(String(e.message ?? e)));
    if (isOwner) {
      fetchInvites(track.id).then(setInvites).catch(() => {});
      listFriends().then((fs) => setFriends(fs.filter((f) => f.status === "accepted"))).catch(() => {});
    }
  }
  useEffect(reload, [track.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const addableFriends = friends.filter((f) => !members.some((m) => m.userId === f.memberId));

  const myRule = members.find((m) => m.userId === me)?.shareRule ?? "totals_only";

  return (
    <div className="mt-3 border-t pt-3">
      {err && <p className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}

      <div className="mb-3">
        <h3 className="mb-1 text-sm font-semibold">Members</h3>
        {members.map((m) => (
          <div key={m.userId} className="flex items-center gap-2 py-1 text-sm">
            <Link href={`/friends/${m.userId}`} className="font-medium hover:text-accent hover:underline">
              {m.displayName}
            </Link>
            {m.role === "owner" && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">owner</span>}
            {m.userId === me ? (
              <select
                value={myRule}
                onChange={(e) =>
                  setMyShareRule(track.id, e.target.value as ShareRule)
                    .then(reload)
                    .catch((ex) => setErr(String(ex.message ?? ex)))
                }
                className="ml-auto rounded-lg border bg-surface px-2 py-1 text-xs"
              >
                <option value="hidden">hidden</option>
                <option value="totals_only">totals only</option>
                <option value="raw_labels">raw labels</option>
              </select>
            ) : (
              <span className="ml-auto text-xs text-faint">{m.shareRule.replace("_", " ")}</span>
            )}
            {isOwner && m.userId !== me && (
              <button onClick={() => void removeMember(track.id, m.userId).then(reload)} className="text-xs text-danger hover:opacity-70">
                remove
              </button>
            )}
          </div>
        ))}
        <p className="mt-1 text-xs text-faint">Your rule: {RULE_INFO[myRule]}</p>
        {isOwner && addableFriends.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-muted">Add a friend to this track:</span>
            {addableFriends.map((f) => (
              <button
                key={f.memberId}
                onClick={() => void addTrackMember(track.id, f.memberId).then(reload).catch((e) => setErr(String(e.message ?? e)))}
                className="rounded-full border px-3 py-1 text-xs hover:bg-surface-2"
              >
                + {f.displayName}
              </button>
            ))}
            <span className="w-full text-xs text-faint">They join as hidden and choose their own sharing — nobody shares data because you clicked a button.</span>
          </div>
        )}
      </div>

      <Board trackId={track.id} me={me} isOwner={isOwner} boardEnabled={track.boardEnabled} onToggled={onDeleted} />

      {track.kind === "day" ? <DayCompare trackId={track.id} /> : <LiftsCompare trackId={track.id} />}

      {/*
        Invite links only exist for people who aren't on DayMax yet — anyone
        with an account gets added from the friend chips above. Tucked away at
        the bottom behind a toggle rather than sitting in the way.
      */}
      {isOwner && (
        <div className="mt-4 border-t pt-3">
          <button onClick={() => setShowInvites((v) => !v)} className="text-xs font-medium text-muted hover:text-accent">
            {showInvites ? "▾" : "▸"} Invite someone who&apos;s not on DayMax yet
          </button>
          {showInvites && (
            <div className="mt-2">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="Restrict to email (optional)" className="w-56 rounded-lg border bg-surface px-2 py-1.5 text-sm" />
                <button
                  onClick={() =>
                    createInvite(track.id, inviteEmail.trim() || null)
                      .then(() => {
                        setInviteEmail("");
                        reload();
                      })
                      .catch((e) => setErr(String(e.message ?? e)))
                  }
                  className="btn-ghost py-1.5"
                >
                  New invite link
                </button>
              </div>
              {invites.filter((i) => !i.acceptedAt).map((i) => {
                const link = `${location.origin}/join/${i.token}`;
                return (
                  <div key={i.id} className="flex items-center gap-2 py-0.5 text-xs">
                    <code className="max-w-[16rem] truncate text-faint">{link}</code>
                    {i.email && <span className="text-faint">({i.email})</span>}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(link).then(() => {
                          setCopied(i.id);
                          setTimeout(() => setCopied(null), 2000);
                        });
                      }}
                      className="font-medium text-accent hover:underline"
                    >
                      {copied === i.id ? "Copied ✓" : "Copy"}
                    </button>
                    <button onClick={() => void deleteInvite(i.id).then(reload)} className="text-danger hover:opacity-70">
                      revoke
                    </button>
                  </div>
                );
              })}
              <p className="mt-1 text-xs text-faint">Send the link however you like — WhatsApp, text. Links expire after 14 days.</p>
            </div>
          )}
        </div>
      )}

      {isOwner && (
        <button
          onClick={() => {
            if (confirm(`Delete track "${track.name}" for everyone? (Nobody's diary data is deleted — only the group.)`))
              void deleteTrack(track.id).then(onDeleted);
          }}
          className="mt-3 text-xs text-danger hover:opacity-70"
        >
          Delete track
        </button>
      )}
    </div>
  );
}

/**
 * The track's message board. Posts are shared with the track by default, or
 * kept private to their author — a note to self that lives with the group but
 * nobody else reads. Owners can switch the whole board off.
 */
function Board({
  trackId,
  me,
  isOwner,
  boardEnabled,
  onToggled,
}: {
  trackId: string;
  me: string;
  isOwner: boolean;
  boardEnabled: boolean;
  onToggled: () => void;
}) {
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("track");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reload() {
    fetchBoard(trackId).then(setPosts).catch(() => {});
  }
  useEffect(reload, [trackId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!boardEnabled) {
    return (
      <div className="mb-4 border-b pb-3">
        <p className="text-sm text-faint">
          The board is off for this track.
          {isOwner && (
            <button
              onClick={() => void setBoardEnabled(trackId, true).then(onToggled)}
              className="ml-2 font-medium text-accent hover:underline"
            >
              turn it on
            </button>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="mb-4 border-b pb-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold">Board</h3>
        {isOwner && (
          <button
            onClick={() => {
              if (confirm("Turn the board off? Existing posts are kept and reappear if you turn it back on."))
                void setBoardEnabled(trackId, false).then(onToggled);
            }}
            className="ml-auto text-xs text-muted hover:text-danger"
          >
            turn off
          </button>
        )}
      </div>

      <div className="mb-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Post something to the track…"
          className="w-full rounded-lg border bg-surface px-3 py-2 text-sm"
        />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as PostVisibility)}
            className="rounded-lg border bg-surface px-2 py-1 text-xs"
          >
            <option value="track">Everyone in this track</option>
            <option value="private">Only me</option>
          </select>
          <button
            onClick={() => {
              if (!body.trim()) return;
              setBusy(true);
              createPost(trackId, body, visibility)
                .then(() => {
                  setBody("");
                  reload();
                })
                .catch((e) => setErr(String(e.message ?? e)))
                .finally(() => setBusy(false));
            }}
            disabled={busy || !body.trim()}
            className="btn-primary py-1"
          >
            {busy ? "Posting…" : "Post"}
          </button>
          {visibility === "private" && <span className="text-xs text-faint">Nobody else will see this.</span>}
        </div>
      </div>
      {err && <p className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}

      {posts.length === 0 ? (
        <p className="text-sm text-faint">Nothing posted yet.</p>
      ) : (
        <div className="space-y-2">
          {posts.map((p) => (
            <div key={p.id} className="rounded-lg border bg-surface p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                <Link href={`/friends/${p.userId}`} className="font-semibold hover:text-accent hover:underline">
                  {p.displayName}
                </Link>
                <span className="text-faint">@{p.username} · {timeAgo(p.createdAt)}</span>
                {p.visibility === "private" && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted">only me</span>
                )}
                {(p.userId === me || isOwner) && (
                  <button
                    onClick={() => {
                      if (confirm("Delete this post?")) void deletePost(p.id).then(reload);
                    }}
                    className="ml-auto text-danger hover:opacity-70"
                  >
                    delete
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{p.body}</p>
              {p.visibility === "track" && (
                <button
                  onClick={() => setOpen(open === p.id ? null : p.id)}
                  className="mt-1.5 text-xs font-medium text-muted hover:text-accent"
                >
                  {p.commentCount > 0 ? `${p.commentCount} comment${p.commentCount === 1 ? "" : "s"}` : "Comment"}
                </button>
              )}
              {open === p.id && <Comments postId={p.id} me={me} onChanged={reload} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Comments({ postId, me, onChanged }: { postId: string; me: string; onChanged: () => void }) {
  const [comments, setComments] = useState<PostComment[]>([]);
  const [body, setBody] = useState("");

  function reload() {
    fetchComments(postId).then(setComments).catch(() => {});
  }
  useEffect(reload, [postId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mt-2 border-t pt-2">
      {comments.map((c) => (
        <div key={c.id} className="py-1 text-sm">
          <Link href={`/friends/${c.userId}`} className="font-medium hover:text-accent hover:underline">
            {c.displayName}
          </Link>
          <span className="ml-1 text-xs text-faint">{timeAgo(c.createdAt)}</span>
          {c.userId === me && (
            <button
              onClick={() => void deleteComment(c.id).then(() => { reload(); onChanged(); })}
              className="ml-2 text-xs text-danger hover:opacity-70"
            >
              delete
            </button>
          )}
          <p className="whitespace-pre-wrap">{c.body}</p>
        </div>
      ))}
      <div className="mt-1 flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && body.trim()) {
              void addComment(postId, body).then(() => {
                setBody("");
                reload();
                onChanged();
              });
            }
          }}
          placeholder="Reply…"
          maxLength={2000}
          className="flex-1 rounded-lg border bg-surface px-2 py-1 text-sm"
        />
        <button
          onClick={() => {
            if (!body.trim()) return;
            void addComment(postId, body).then(() => {
              setBody("");
              reload();
              onChanged();
            });
          }}
          disabled={!body.trim()}
          className="btn-ghost py-1 text-xs"
        >
          Reply
        </button>
      </div>
    </div>
  );
}
