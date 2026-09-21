"use client";

/**
 * Daily feed on a challenge page: one thread per day of the challenge.
 * Members post text and/or an image; other members like and comment;
 * comments get their own likes. Comment inserts trigger the notify_
 * challenge_comment trigger in migration 0041 which pings the post
 * author via the notifications bell.
 *
 * Deliberately compact: this sits UNDER the leaderboards + panels on
 * the challenge page, not next to them. A day picker across the top
 * lets you scrub through the challenge; today is highlighted.
 */

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { localToday } from "@/lib/dates";
import {
  createComment,
  createPost,
  deleteComment,
  deletePost,
  fetchAllPosts,
  fetchComments,
  subscribeToFeed,
  toggleCommentLike,
  togglePostLike,
  uploadPostImage,
  type FeedComment,
  type FeedPost,
} from "@/lib/challengeFeed";

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (d <= end) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/**
 * "5m · 15:32" -- relative age plus the actual clock time, since
 * 'now' alone doesn't say *when* now was, and readers wanted 'more
 * info of when posted what time'. If the post is older than 24h,
 * the clock time gets a date prefix ("Sep 21, 15:32") so it's
 * unambiguous. Full ISO stays in the caller's title attribute for
 * long-press / hover, so anyone can pin down the exact second.
 */
function postedAt(iso: string): string {
  const d = new Date(iso);
  const clock = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  const ageMs = Date.now() - d.getTime();
  const olderThanDay = ageMs > 86400 * 1000;
  const rel = relTime(iso);
  const stamp = olderThanDay
    ? `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${clock}`
    : clock;
  return `${rel} · ${stamp}`;
}
function fullStamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function ChallengeFeed({
  challengeId,
  startsOn,
  endsOn,
  me,
  isMember,
}: {
  challengeId: string;
  startsOn: string;
  endsOn: string;
  me: string | null;
  isMember: boolean;
}) {
  const today = localToday();
  const days = useMemo(() => dateRange(startsOn, endsOn), [startsOn, endsOn]);
  // Composer defaults to today when it's inside the window,
  // otherwise the last day of the challenge -- so a post-challenge
  // 'what happened' post gets attached to a day inside the window.
  const composeDate = today >= startsOn && today <= endsOn ? today : endsOn < today ? endsOn : startsOn;
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchAllPosts(challengeId, days)
      .then(setPosts)
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, [challengeId, days]);

  useEffect(refresh, [refresh]);
  // realtime -- any change on the challenge's feed tables refetches
  useEffect(() => subscribeToFeed(challengeId, refresh), [challengeId, refresh]);

  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="font-semibold">Feed</h2>
        <span className="text-xs text-faint">{startsOn} → {endsOn}</span>
      </div>

      {/* Day picker was here. Killed on feedback -- users wanted
          the whole challenge's feed in one scroll, not one day at a
          time. Composer still writes to a specific day (today, or
          the challenge's end if the challenge already finished);
          the feed now shows every post across the whole window,
          newest first. */}

      {isMember && <PostComposer challengeId={challengeId} date={composeDate} onPosted={refresh} />}

      <div className="mt-3 rounded-xl border border-border/60 bg-surface-2/30 p-2">
        {loading && posts.length === 0 && <p className="p-2 text-sm text-faint">Loading…</p>}
        {!loading && posts.length === 0 && (
          <p className="p-4 text-center text-sm text-muted">
            Nothing posted yet. {isMember ? "Be the first." : "Members' posts will show here."}
          </p>
        )}
        <div className="space-y-2">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} me={me} onChanged={refresh} />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Compose a new post: text + optional image. Uploads then inserts. */
function PostComposer({
  challengeId,
  date,
  onPosted,
}: {
  challengeId: string;
  date: string;
  onPosted: () => void;
}) {
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!body.trim() && !file) return;
    setBusy(true);
    setErr(null);
    try {
      let imagePath: string | null = null;
      if (file) imagePath = await uploadPostImage(challengeId, file);
      await createPost(challengeId, date, body, imagePath);
      setBody("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onPosted();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Share how it's going…"
        rows={2}
        className="w-full resize-none rounded-lg border bg-surface px-3 py-2 text-sm"
      />
      {file && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          <span className="truncate">📎 {file.name}</span>
          <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }} className="text-danger">remove</button>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <label className="btn-ghost cursor-pointer py-1 text-xs">
          + Photo
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="hidden"
          />
        </label>
        <button
          onClick={() => void submit()}
          disabled={busy || (!body.trim() && !file)}
          className="btn-primary py-1"
        >
          {busy ? "Posting…" : "Post"}
        </button>
        {err && <span className="text-xs text-danger">{err}</span>}
      </div>
    </div>
  );
}

function PostCard({ post, me, onChanged }: { post: FeedPost; me: string | null; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load comments once expanded.
  useEffect(() => {
    if (!expanded || comments) return;
    fetchComments(post.id).then(setComments).catch(() => setComments([]));
  }, [expanded, comments, post.id]);

  // If the top-line comment_count changes (a realtime tick), invalidate
  // the loaded thread so the next expand refreshes.
  useEffect(() => { setComments(null); }, [post.commentCount]);

  async function like() {
    try { await togglePostLike(post.id, post.myLike); onChanged(); }
    catch (e: any) { setErr(String(e.message ?? e)); }
  }

  async function comment() {
    if (!commentBody.trim()) return;
    setBusy(true); setErr(null);
    try {
      await createComment(post.id, commentBody);
      setCommentBody("");
      const rows = await fetchComments(post.id);
      setComments(rows);
      onChanged();
    } catch (e: any) { setErr(String(e.message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <article className="card p-3">
      <header className="mb-2 flex items-baseline gap-2">
        <Link href={`/friends/${post.userId}`} className="text-sm font-semibold hover:text-accent hover:underline">
          {post.displayName}
        </Link>
        {post.username && <span className="text-xs text-faint">@{post.username}</span>}
        <span
          className="ml-auto text-[10px] text-faint"
          title={fullStamp(post.createdAt)}
        >
          {postedAt(post.createdAt)}
        </span>
        {post.mine && (
          <button
            onClick={() => { if (confirm("Delete this post?")) void deletePost(post.id).then(onChanged); }}
            className="text-[10px] text-danger hover:underline"
          >
            delete
          </button>
        )}
      </header>

      {post.body && <p className="whitespace-pre-wrap text-sm">{post.body}</p>}
      {post.imageUrl && (
        <div className="mt-2 overflow-hidden rounded-lg border">
          {/* next/image needs remote patterns config; use <img> to keep
              this migration standalone. Storage returns cache-friendly
              URLs already. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.imageUrl} alt="" loading="lazy" className="max-h-[420px] w-full object-cover" />
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-xs">
        <button
          onClick={() => void like()}
          className={`inline-flex items-center gap-1 hover:text-accent ${post.myLike ? "font-semibold text-accent" : "text-muted"}`}
          aria-pressed={post.myLike}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill={post.myLike ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.7 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
          </svg>
          {post.likeCount || ""}
        </button>
        <button onClick={() => setExpanded((e) => !e)} className="inline-flex items-center gap-1 text-muted hover:text-accent">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {post.commentCount || "Reply"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 border-t pt-3">
          {comments === null ? (
            <p className="text-xs text-faint">Loading…</p>
          ) : (
            <ul className="space-y-2">
              {comments.map((c) => (
                <CommentRow key={c.id} comment={c} me={me} onChanged={onChanged} onReloaded={(rows) => setComments(rows)} postId={post.id} />
              ))}
              {comments.length === 0 && <li className="text-xs text-faint">No comments yet.</li>}
            </ul>
          )}
          <div className="mt-2 flex items-center gap-2">
            <input
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void comment(); } }}
              placeholder="Reply…"
              className="flex-1 rounded-lg border bg-surface px-2 py-1.5 text-xs"
            />
            <button onClick={() => void comment()} disabled={busy || !commentBody.trim()} className="btn-primary py-1 text-xs">
              {busy ? "…" : "Send"}
            </button>
          </div>
          {err && <p className="mt-1 text-xs text-danger">{err}</p>}
        </div>
      )}
    </article>
  );
}

function CommentRow({
  comment,
  me,
  onChanged,
  onReloaded,
  postId,
}: {
  comment: FeedComment;
  me: string | null;
  onChanged: () => void;
  onReloaded: (rows: FeedComment[]) => void;
  postId: string;
}) {
  async function like() {
    try {
      await toggleCommentLike(comment.id, comment.myLike);
      const rows = await fetchComments(postId);
      onReloaded(rows);
      onChanged();
    } catch { /* swallow */ }
  }
  return (
    <li className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <Link href={`/friends/${comment.userId}`} className="text-xs font-semibold hover:text-accent hover:underline">
            {comment.displayName}
          </Link>
          <span
            className="text-[10px] text-faint"
            title={fullStamp(comment.createdAt)}
          >
            {postedAt(comment.createdAt)}
          </span>
          {comment.mine && (
            <button
              onClick={() => { if (confirm("Delete this comment?")) void deleteComment(comment.id).then(async () => { onReloaded(await fetchComments(postId)); onChanged(); }); }}
              className="text-[10px] text-danger hover:underline"
            >
              delete
            </button>
          )}
        </div>
        <p className="text-xs">{comment.body}</p>
      </div>
      <button
        onClick={() => void like()}
        className={`inline-flex shrink-0 items-center gap-0.5 text-[11px] hover:text-accent ${comment.myLike ? "font-semibold text-accent" : "text-faint"}`}
        aria-pressed={comment.myLike}
      >
        <svg viewBox="0 0 24 24" width="11" height="11" fill={comment.myLike ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.7 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
        </svg>
        {comment.likeCount || ""}
      </button>
    </li>
  );
}
