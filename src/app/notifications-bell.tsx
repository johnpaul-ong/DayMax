"use client";

/**
 * Nav bell: the in-app inbox.
 *
 * Shows an unread badge, opens a drawer with the last N notifications,
 * lets you mark-read either one-by-one (by clicking) or all at once.
 * Subscribes to public.notifications via Supabase realtime so a ping
 * that lands while the tab is open updates the badge without a
 * refresh. Turns itself off entirely when signed out.
 *
 * Deliberately unstyled beyond .card and the accent colour so it
 * picks up every theme (light / midnight / cottage) without
 * per-theme code.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllRead,
  markRead,
  subscribeToNotifications,
  type Notification,
} from "@/lib/notifications";

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.round((now - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function kindEmoji(kind: string): string {
  switch (kind) {
    case "friend_request": return "👤";
    case "friend_accepted": return "✓";
    case "challenge_invite": return "⚔";
    case "comment_reply": return "💬";
    case "comment_like": return "♥";
    case "summary_ready": return "📊";
    case "challenge_ended": return "🏁";
    default: return "•";
  }
}

export default function NotificationsBell() {
  const [me, setMe] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Whoever's signed in — the bell only mounts realtime for that person.
  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    const { data: sub } = createClient().auth.onAuthStateChange((_e, s) => {
      setMe(s?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // The badge and the drawer both refetch through this — same source of truth.
  const refresh = useCallback(() => {
    fetchUnreadCount().then(setUnread).catch(() => {});
    if (open) {
      setLoading(true);
      fetchNotifications(50)
        .then(setItems)
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [open]);

  // First badge count on mount, and whenever auth flips.
  useEffect(() => {
    if (!me) { setUnread(0); setItems([]); return; }
    refresh();
    const unsub = subscribeToNotifications(me, refresh);
    return unsub;
  }, [me, refresh]);

  // When the drawer opens, pull the full list.
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // Close on outside click / Escape, when open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  if (!me) return null;

  return (
    <div className="relative" ref={drawerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-lg hover:bg-surface-2"
        title="Notifications"
      >
        {/* Simple bell glyph — no external icon dep, works on every theme. */}
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-tight text-accent-contrast"
            style={{ height: 18 }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card absolute right-0 top-11 z-50 w-[min(360px,calc(100vw-1rem))] overflow-hidden p-0"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <h3 className="text-sm font-semibold">Notifications</h3>
            <span className="text-xs text-faint">{unread > 0 ? `${unread} unread` : "all caught up"}</span>
            {unread > 0 && (
              <button
                onClick={() => void markAllRead().then(refresh)}
                className="ml-auto text-xs font-medium text-accent hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {loading && items.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-faint">Loading…</p>
            )}
            {!loading && items.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-muted">Nothing here yet.</p>
            )}
            <ul className="divide-y">
              {items.map((n) => {
                const inner = (
                  <div
                    onClick={() => { if (!n.readAt) void markRead(n.id).then(refresh); setOpen(false); }}
                    className={`flex items-start gap-2.5 px-3 py-2.5 text-sm transition ${
                      n.readAt ? "opacity-70" : "bg-accent-soft/40"
                    } hover:bg-surface-2`}
                  >
                    <span aria-hidden="true" className="mt-0.5 text-base leading-none">{kindEmoji(n.kind)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{n.title}</p>
                      {n.body && <p className="truncate text-xs text-muted">{n.body}</p>}
                      <p className="mt-0.5 text-[10px] text-faint">{relativeTime(n.createdAt)} ago</p>
                    </div>
                    {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="unread" />}
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link href={n.link} className="block">{inner}</Link>
                    ) : (
                      inner
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
