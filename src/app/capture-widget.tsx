"use client";

/**
 * The Quick Capture box.
 *
 * Design rules, in priority order:
 *   1. Enter must be enough. Type words, press Enter, it saves and advances to
 *      the next unfilled slot. No mouse, no category picker for anything you've
 *      logged before.
 *   2. Never trap the user. Esc skips one, "Later" snoozes, "Not today" stops
 *      until tomorrow. All one click, all obvious.
 *   3. Never nag. Quiet hours, a lookback limit, and a queue cap mean it can't
 *      greet you with forty boxes after a weekend away.
 *
 * Mounted globally in layout.tsx, so it works from whatever page you're on.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CATEGORIES, categoryColor, categoryName, slotToTime } from "@/lib/categories";
import { fetchDayEntries, upsertDayEntries } from "@/lib/data";
import { localToday } from "@/lib/dates";
import {
  buildQueue,
  clearSnooze,
  guessCategory,
  inQuietHours,
  isSnoozed,
  learnLabels,
  loadCaptureSettings,
  slotForTime,
  snoozeUntil,
  suggestLabels,
  type CaptureSettings,
  type LabelMemory,
} from "@/lib/capture";

const EMPTY_MEMORY: LabelMemory = { category: new Map(), suggestions: [] };

export default function CaptureWidget() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<number[]>([]);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [filled, setFilled] = useState<Set<number>>(new Set());
  const [memory, setMemory] = useState<LabelMemory>(EMPTY_MEMORY);
  const [label, setLabel] = useState("");
  const [cat, setCat] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Closed by hand: silences the CURRENT slot only. When the ticker
   *  sees a slot boundary that wasn't in the queue at dismiss-time it
   *  clears this so the next 15-minute mark can ping again. See the
   *  slot-boundary re-arm in the ticker below. */
  const dismissedRef = useRef(false);
  /** Newest queued slot at the moment we set dismissedRef. */
  const dismissedAtSlot = useRef<number | null>(null);
  const [justSaved, setJustSaved] = useState<number | null>(null);
  const [lastEntry, setLastEntry] = useState<{ category: number; label: string | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const date = localToday();
  /**
   * True once we've confirmed the user has EVER logged a day_entry.
   * Reviewer flagged that a brand-new user with zero data would see
   * "What were you doing at 09:15?" as their first-ever DayMax
   * interaction, which reads as an intrusion. Ticker below gates on
   * this so a first-timer only starts getting prompts AFTER they've
   * manually logged at least one slot via /today. Flip permanently
   * on the first save via daymax-day-saved event too.
   */
  const [hasEverLogged, setHasEverLogged] = useState<boolean | null>(null);

  // Refs mirror the state the ticker reads. Without these the interval effect
  // depends on `filled`/`skipped`, so every single save tore down and rebuilt
  // the timer — which is what made this feel laggy.
  const filledRef = useRef(filled);
  const skippedRef = useRef(skipped);
  const settingsRef = useRef(settings);
  useEffect(() => { filledRef.current = filled; }, [filled]);
  // Cross midnight with the tab open and yesterday's skipped slot indexes
  // were still suppressing today's.
  useEffect(() => { setSkipped(new Set()); }, [date]);
  useEffect(() => { skippedRef.current = skipped; }, [skipped]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // --- only ever run for a signed-in person -----------------------------------
  // It was rendering on the sign-in page and before an account existed, which
  // is both confusing and pointless — there's nowhere to save to.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session?.user);
      if (!session?.user) {
        setQueue([]);
        setOpen(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const read = () => setSettings(loadCaptureSettings());
    read();
    window.addEventListener("daymax-capture-changed", read);
    return () => window.removeEventListener("daymax-capture-changed", read);
  }, []);

  // --- what's already logged today --------------------------------------------
  /**
   * Returns the slots as they are NOW, as well as setting state.
   *
   * THE BUG: tick() used to `await refresh()` and then read `filledRef.current`.
   * setFilled is async, React had not committed it, and the ref is only updated
   * by an effect that runs after commit — so the await bought nothing and every
   * tick decided using the PREVIOUS tick's data. That is what made it ask about
   * slots that were already filled.
   */
  const refresh = useCallback(async (): Promise<Set<number>> => {
    try {
      const today = await fetchDayEntries(date, date);
      const slots = new Set(today.map((e) => e.slot));
      setFilled(slots);
      const sorted = [...today].sort((a, b) => b.slot - a.slot);
      setLastEntry(sorted[0] ? { category: sorted[0].category, label: sorted[0].label } : null);
      return slots;
    } catch {
      // offline or signed out — stay quiet rather than popping an error box
      return filledRef.current;
    }
  }, [date]);

  useEffect(() => {
    if (!signedIn || !settings?.enabled) return;
    void refresh();
    const from = new Date();
    from.setDate(from.getDate() - 60);
    fetchDayEntries(localToday(from), date)
      .then((es) => {
        setMemory(learnLabels(es));
        // First-timer gate: any entry in the last 60 days means they
        // are NOT brand-new. Flip the flag on.
        if (es.length > 0) setHasEverLogged(true);
        else setHasEverLogged(false);
      })
      .catch(() => {});
  }, [signedIn, settings?.enabled, refresh, date]);

  // Also flip the flag on when the user saves their first slot from
  // any surface. Doesn't need to persist -- next mount rechecks
  // day_entries anyway.
  useEffect(() => {
    const onSaved = () => setHasEverLogged(true);
    window.addEventListener("daymax-day-saved", onSaved);
    return () => window.removeEventListener("daymax-day-saved", onSaved);
  }, []);

  // Re-read today's slots whenever you come back to the app or navigate. This
  // is the fix for "it asks about a slot I already filled": logging on /today
  // or /day used to leave this component's idea of the day stale until reload.
  //
  // Also: prune the queue of any slots that became filled externally, so the
  // popup advances/closes as soon as the user paints its current slot on
  // /today (rather than waiting up to 60s for the ticker to rebuild). Queue
  // is the source of truth for `current` (L318) and the render gate (L387),
  // so removing a filled slot from the queue is what actually closes the
  // widget. dismissedRef is untouched — a manual dismiss stays dismissed,
  // and a genuinely-new slot still lifts the dismissal via the ticker's
  // re-arm logic and the topSlot effect below.
  useEffect(() => {
    if (!signedIn || !settings?.enabled) return;
    const syncAfterSave = async () => {
      const fresh = await refresh();
      setQueue((q) => q.filter((s) => !fresh.has(s)));
    };
    void syncAfterSave();
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncAfterSave();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", syncAfterSave);
    window.addEventListener("daymax-day-saved", syncAfterSave);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", syncAfterSave);
      window.removeEventListener("daymax-day-saved", syncAfterSave);
    };
  }, [signedIn, settings?.enabled, refresh, pathname]);

  // --- the ticker. One stable interval, reading refs. --------------------------
  useEffect(() => {
    if (!signedIn || !settings?.enabled) return;

    const tick = async () => {
      const s = settingsRef.current;
      if (!s?.enabled) return;
      // First-timer gate: don't ping a user who has never logged
      // anything. `null` = still checking. Once true, this stays true.
      if (hasEverLogged !== true) return setQueue([]);
      const now = new Date();
      if (inQuietHours(now.getHours(), s.quietFrom, s.quietTo)) return setQueue([]);
      if (isSnoozed()) return setQueue([]);

      // refetch before deciding, and USE what came back
      const fresh = await refresh();
      const q = buildQueue({
        filledSlots: fresh,
        nowSlot: slotForTime(now),
        lookbackSlots: Math.round(s.lookbackMin / 15),
        maxQueue: s.maxQueue,
        skipped: skippedRef.current,
      });
      setQueue(q);
      // Re-arm on a NEW slot boundary: if a slot has come up that
      // didn't exist when the user dismissed, clear the dismissal.
      // Otherwise 'x' silenced Quick Capture until page refresh, which
      // is what made it feel broken.
      const newest = q.length > 0 ? q[q.length - 1] : null;
      if (dismissedRef.current && newest !== null && newest !== dismissedAtSlot.current) {
        dismissedRef.current = false;
        dismissedAtSlot.current = null;
      }
      if (q.length > 0 && !dismissedRef.current) setOpen(true);
    };

    void tick();
    // 60s: a 15-minute slot doesn't need 30-second precision, and halving the
    // wake-ups halves the background work on a phone
    const id = setInterval(() => void tick(), 60_000);
    return () => clearInterval(id);
    // hasEverLogged in deps so the ticker re-runs (and starts pinging)
    // the moment a first-timer's flag flips true.
  }, [signedIn, settings?.enabled, refresh, hasEverLogged]);

  // --- desktop notification when the tab is in the background -----------------
  /**
   * OS notifications.
   *
   * The old effect gated on three things and any one killed it silently:
   *   1. Notification.permission had to be "granted" -- but nothing ever
   *      REQUESTED it, so it sat at "default" forever.
   *   2. document.visibilityState had to NOT be "visible", which meant no
   *      notification ever fired while the tab was focused -- exactly when
   *      you wanted one if you were on a different app in the same window.
   *   3. settings.notify had to be true, which it is by default, but if it
   *      had been switched off there was no visible path to switch it back.
   *
   * Now: request permission the first time notify is on, and let the OS
   * decide whether to show the notification (both macOS and Windows Chrome
   * show them while the tab is focused, subject to Do Not Disturb).
   */
  const notified = useRef<number | null>(null);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!settings?.notify) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "default") return;
    if (requestedRef.current) return;
    requestedRef.current = true;
    // must be a user-gesture-friendly moment -- we're inside an effect that
    // ran because settings.notify became true, which itself came from a click
    Notification.requestPermission().catch(() => {});
  }, [settings?.notify]);

  useEffect(() => {
    if (!settings?.notify || queue.length === 0) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const newest = queue[queue.length - 1];
    if (notified.current === newest) return; // one ping per slot, not per tick
    notified.current = newest;
    try {
      new Notification("DayMax", {
        body: queue.length === 1 ? `What were you doing at ${slotToTime(newest)}?` : `${queue.length} slots to fill in`,
        tag: "daymax-capture",
        // renotify: reissue the toast if the tag already exists, so a NEW
        // slot supersedes the previous notification cleanly
        // (Chrome ignores it without requireInteraction; harmless)
        renotify: true,
      } as NotificationOptions);
    } catch {}
  }, [queue, settings?.notify]);

  // --- hotkey: Ctrl/Cmd+J opens the box and focuses the field -----------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        clearSnooze();
        dismissedRef.current = false;
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Take a slot off the queue NOW.
   *
   * THE BUG: save() added the slot to `filled` and stopped there. `queue` was
   * only ever rebuilt by the 60-second ticker, so after pressing Save the same
   * box sat on screen for up to a minute looking like the save had failed.
   * Skip had the identical problem. The write was always fine; the widget just
   * never advanced.
   */
  const advance = useCallback((slot: number) => {
    setQueue((q) => q.filter((s) => s !== slot));
  }, []);

  // A brand-new slot is new information, so it lifts a manual dismissal.
  // Without this the x would be a permanent mute rather than "not now".
  const topSlot = queue[0] ?? null;
  const lastTop = useRef<number | null>(null);
  useEffect(() => {
    if (topSlot !== null && lastTop.current !== null && topSlot !== lastTop.current) {
      dismissedRef.current = false;
    }
    lastTop.current = topSlot;
  }, [topSlot]);

  // Nothing left to ask about — get out of the way. Also covers the ticker
  // emptying the queue (quiet hours, snooze, everything filled elsewhere).
  useEffect(() => {
    if (queue.length === 0) setOpen(false);
  }, [queue.length]);

  const current = queue[0] ?? null;
  const guessed = useMemo(() => guessCategory(label, memory), [label, memory]);
  const effectiveCat = cat ?? guessed ?? lastEntry?.category ?? null;
  const hints = useMemo(() => suggestLabels(label, memory, 5), [label, memory]);

  // focus whenever a new slot comes up, so a queue is pure typing
  // Focus ONLY when the person asked for it (hotkey, or clicking the box).
  // It used to focus whenever a slot came up, which yanks your cursor out of
  // whatever you were typing the moment the reminder appears. Outlook
  // reminders never take focus, and this should not either.
  useEffect(() => {
    setError(null);
  }, [open, current]);

  async function save(useCat: number | null, useLabel: string) {
    if (current === null) return;
    if (useCat === null) {
      // A disabled Save button that silently does nothing is indistinguishable
      // from a broken one. Say what's missing instead.
      setError("Pick a category below first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await upsertDayEntries([{ date, slot: current, category: useCat, label: useLabel.trim() || null }]);
      setFilled((prev) => new Set(prev).add(current));
      setJustSaved(current);
      setTimeout(() => setJustSaved(null), 1200);
      setLabel("");
      setCat(null);
      setLastEntry({ category: useCat, label: useLabel.trim() || null });
      advance(current);
      window.dispatchEvent(new Event("daymax-day-saved"));
    } catch (e: any) {
      // Keep it in the queue so nothing is lost, but SAY SO — swallowing this
      // was the other way "I click save and it doesn't leave" could happen.
      setError(String(e?.message ?? e) || "Could not save — still here so you can retry.");
    } finally {
      setSaving(false);
    }
  }

  function skipOne() {
    if (current === null) return;
    setSkipped((prev) => new Set(prev).add(current));
    setLabel("");
    setCat(null);
    setError(null);
    advance(current);
  }

  function fillRestWithSame() {
    if (!lastEntry) return;
    const all = queue;
    setSaving(true);
    setError(null);
    upsertDayEntries(all.map((s) => ({ date, slot: s, category: lastEntry.category, label: lastEntry.label })))
      .then(() => {
        setFilled((prev) => new Set([...prev, ...all]));
        setQueue([]);
        window.dispatchEvent(new Event("daymax-day-saved"));
      })
      .catch((e: any) => setError(String(e?.message ?? e) || "Could not save those."))
      .finally(() => setSaving(false));
  }

  // never on the auth screens, and never before there's an account to save to
  const onAuthScreen = ["/signin", "/welcome", "/auth"].some((p) => pathname.startsWith(p));
  if (!signedIn || onAuthScreen || !settings?.enabled || !open || current === null) return null;

  return (
    /*
     * Outlook-style reminder: anchored BOTTOM-RIGHT on desktop (a fixed
     * ~380px card), full-width above the tab bar on phones (sits above
     * MobileNav, which is z-40; this is z-50). Uses inline style rather
     * than Tailwind's `sm:` classes for the mobile-vs-desktop switch --
     * the previous class-based version placed the box at the wrong
     * corner on narrower desktop windows where sm: hadn't kicked in
     * yet, which is what "popping up weird" on the screenshot was.
     *
     * ABOUT DESKTOP: this is an IN-APP popup (only visible when the
     * DayMax tab is open). OS-level desktop notifications are separate
     * and go through the PWA push-subscription flow (Settings ->
     * Notifications), which is what actually reaches you when the tab
     * isn't in the foreground.
     */
    <div
      className="daymax-reminder overflow-auto"
      role="dialog"
      aria-label="What were you doing?"
      style={{
        // Bottom-right anchored, always. Uses inset shorthand with
        // auto on top/left so nothing in globals can hijack the
        // sides. Previous clamp-on-right version was landing on the
        // left of the viewport on some window sizes -- likely a
        // theme rule fighting Tailwind's `fixed`. Belt and braces:
        // explicit position + z-index inline, plus insets nailed
        // to bottom-right with margins for the safe area.
        position: "fixed",
        inset: "auto 24px calc(env(safe-area-inset-bottom, 0px) + 24px) auto",
        width: "min(380px, calc(100vw - 32px))",
        maxHeight: "calc(100vh - 3rem)",
        zIndex: 55,
      }}
      onMouseDown={() => inputRef.current?.focus()}
    >
      <div className="card border border-accent-soft p-3 shadow-2xl ring-1 ring-black/5">
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-sm font-semibold tabular-nums">
            {slotToTime(current)}–{slotToTime(current + 1)}
          </h2>
          <span className="text-xs text-muted">what were you doing?</span>
          {queue.length > 1 && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted">
              {queue.length} to go
            </span>
          )}
          <button
            onClick={() => {
              dismissedRef.current = true;
              // remember which slot we dismissed at, so the ticker
              // re-arms on the NEXT boundary rather than staying quiet.
              dismissedAtSlot.current = queue.length > 0 ? queue[queue.length - 1] : null;
              setOpen(false);
            }}
            aria-label="Close"
            className="ml-auto text-lg leading-none text-faint hover:text-ink"
          >
            ×
          </button>
        </div>

        <input
          ref={inputRef}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            /*
             * Keyboard shortcuts on the capture field, in order of precedence:
             *   Alt+0..9  pick that category (0 Sleep, 1 Work, ..., 9 Leisure)
             *             Alt because bare digits are legitimate text (e.g.
             *             "5km run"), so we must not eat them.
             *   ArrowLeft / ArrowRight  step the current category selection.
             *             Cycles, so ← from Sleep lands on Leisure.
             *   Enter     save. If Enter is pressed AND no category is picked
             *             yet (either explicitly or by guessCategory), focus
             *             the CURRENT best category and require a second Enter
             *             to actually save -- so "Enter chooses the category"
             *             becomes literal: first Enter picks, second Enter
             *             commits.
             *   Escape    skip.
             *   ArrowUp   repeat last entry.
             */
            if (e.key === "Enter") {
              e.preventDefault();
              // If nothing is selected yet, first Enter locks in whatever
              // the guess/best category is and waits for a second Enter.
              // Otherwise saves immediately.
              if (cat === null && effectiveCat !== null) {
                setCat(effectiveCat);
                return;
              }
              void save(effectiveCat, label);
            } else if (e.key === "Escape") {
              e.preventDefault();
              skipOne();
            } else if (e.altKey && e.key >= "0" && e.key <= "9") {
              // Alt+digit picks the category directly, without any
              // interference with typing "5km" etc.
              e.preventDefault();
              setCat(Number(e.key));
            } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              // step through categories. Only when the cursor is at the
              // end/start of the input so arrows still edit text mid-word.
              const el = e.currentTarget;
              const dir = e.key === "ArrowRight" ? 1 : -1;
              const atEdge = (dir === 1 && el.selectionEnd === el.value.length) ||
                             (dir === -1 && el.selectionStart === 0);
              if (atEdge) {
                e.preventDefault();
                const cur = effectiveCat ?? 0;
                const next = (cur + dir + CATEGORIES.length) % CATEGORIES.length;
                setCat(next);
              }
            } else if (e.key === "ArrowUp" && !label && lastEntry) {
              // repeat the previous slot without typing
              e.preventDefault();
              setLabel(lastEntry.label ?? "");
              setCat(lastEntry.category);
            }
          }}
          placeholder={lastEntry?.label ? `e.g. ${lastEntry.label} — ↑ to repeat` : "a few words…"}
          list="daymax-capture-hints"
          className="w-full rounded-lg border bg-surface px-3 py-2 text-sm"
        />
        <datalist id="daymax-capture-hints">
          {hints.map((h) => (
            <option key={h.label} value={h.label} />
          ))}
        </datalist>

        <div className="mt-2 flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.code}
              onClick={() => setCat(c.code)}
              title={c.name}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                effectiveCat === c.code ? "text-white" : "bg-surface-2 text-muted hover:text-ink"
              }`}
              style={effectiveCat === c.code ? { background: categoryColor(c.code) } : undefined}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void save(effectiveCat, label)}
            disabled={saving}
            className={`btn-primary py-1 ${effectiveCat === null ? "opacity-60" : ""}`}
          >
            {saving ? "…" : "Save ⏎"}
          </button>
          <button onClick={skipOne} className="btn-ghost py-1 text-xs">Skip</button>
          {queue.length > 1 && lastEntry && (
            <button onClick={fillRestWithSame} className="btn-ghost py-1 text-xs">
              All {queue.length} as &ldquo;{lastEntry.label || categoryName(lastEntry.category)}&rdquo;
            </button>
          )}
          <span className="ml-auto flex gap-2 text-xs">
            <button
              onClick={() => {
                snoozeUntil(60 * 60 * 1000);
                setOpen(false);
              }}
              className="text-muted hover:text-accent"
            >
              Later
            </button>
            <button
              onClick={() => {
                snoozeUntil(24 * 60 * 60 * 1000);
                setOpen(false);
              }}
              className="text-muted hover:text-danger"
            >
              Not today
            </button>
          </span>
        </div>

        {error && <p className="mt-2 text-xs font-medium text-danger">{error}</p>}

        <p className="mt-2 text-[10px] text-faint">
          {justSaved !== null ? (
            <span className="text-ok">Saved {slotToTime(justSaved)} ✓</span>
          ) : (
            <>
              ⌘/Ctrl+J anywhere · Enter saves · Esc skips ·{" "}
              <span title="Alt+0..9 picks a category directly, or use ←/→ to step">Alt+0-9 or ←/→ for category</span>
              {effectiveCat !== null && guessed !== null && cat === null && <> · category guessed from your history</>}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
