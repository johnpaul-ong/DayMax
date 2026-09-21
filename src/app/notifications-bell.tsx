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
import { createPortal } from "react-dom";
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
  // drawerRef points at the trigger, panelRef at the floating panel
  // inside the portal. Outside-click closure needs both so a click
  // inside the panel (which lives outside the bell's DOM subtree
  // once portalled) doesn't count as 'outside'.
  const drawerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Client-rect anchor for the portalled panel. Recomputed on open,
  // on window resize and on scroll so the panel tracks the bell.
  const [anchor, setAnchor] = useState<{ right: number; top: number } | null>(null);

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

  // Close on outside click / Escape, when open. Panel is portalled
  // so outside-click has to check both the trigger and the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (drawerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  // Recompute the portal anchor whenever the panel opens, the
  // viewport resizes, or the page scrolls. Fixed-position coords in
  // viewport space -- keeps the panel pinned to the bell across
  // sticky-nav re-flow and page scroll.
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (r) setAnchor({ right: window.innerWidth - r.right, top: r.bottom + 4 });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  if (!me) return null;
  // Bell hides itself when there are no unread. It reappears the
  // moment something lands (realtime subscription). Old notifications
  // are still readable while the drawer is open, so pinning a
  // permanent bell just to expose history is dead weight.
  if (unread === 0 && !open) return null;

  return (
    <div className="relative shrink-0" ref={drawerRef}>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications (${unread} unread)`}
        // Fixed 32x32 button, matches nav-link sizing so opening the
        // drawer or the bell appearing/disappearing never shifts nav
        // height. Drawer is absolute-positioned below, so unfolding
        // it doesn't push the bar either.
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface-2"
        title="Notifications"
      >
        {/* Real SVG bell — one path, currentColor, no external icon
            library. Sized to sit inside the 32x32 button. */}
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="text-ink"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            className="absolute -right-1 -top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold leading-none text-accent-contrast"
            style={{ height: 16 }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && anchor && typeof document !== "undefined" && createPortal(
        /* Portalled to <body> so the panel escapes the nav's
           overflow-x-auto clipping (which was hiding the whole
           thing behind page content). Fixed positioning tracks the
           bell's client rect via the anchor state -- follows scroll
           + resize. Same compact popover styling as the Group /
           People pickers. */
        <div
          ref={panelRef}
          className="fixed z-[100] w-[min(320px,calc(100vw-1rem))] overflow-hidden rounded-lg border bg-surface text-ink shadow-lg"
          style={{ top: anchor.top, right: anchor.right }}
          role="dialog"
          aria-label="Notifications"
        >
          <div className="sticky top-0 flex items-center gap-2 border-b bg-surface px-3 py-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-faint">Notifications</h3>
            <span className="text-[10px] text-faint">{unread > 0 ? `${unread} unread` : "all caught up"}</span>
            {unread > 0 && (
              <button
                onClick={() => void markAllRead().then(refresh)}
                className="ml-auto text-[10px] font-medium text-accent hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {loading && items.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-faint">Loading…</p>
            )}
            {!loading && items.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted">Nothing here yet.</p>
            )}
            <ul>
              {items.map((n) => {
                const inner = (
                  <div
                    onClick={() => { if (!n.readAt) void markRead(n.id).then(refresh); setOpen(false); }}
                    className={`flex items-start gap-2 px-3 py-2 text-sm transition ${
                      n.readAt ? "opacity-70" : "bg-accent-soft/30"
                    } hover:bg-surface-2`}
                  >
                    <span aria-hidden="true" className="mt-0.5 text-sm leading-none">{kindEmoji(n.kind)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{n.title}</p>
                      {n.body && <p className="truncate text-[11px] text-muted">{n.body}</p>}
                      <p className="mt-0.5 text-[10px] text-faint">{relativeTime(n.createdAt)} ago</p>
                    </div>
                    {!n.readAt && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="unread" />}
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
        </div>,
        document.body
      )}
    </div>
  );
}
