"use client";

/**
 * Quick Capture prompt settings + push-notification preferences +
 * "is Quick Capture actually working right now" live diagnostic.
 * Extracted from page.tsx unchanged.
 */

import { useEffect, useState } from "react";
import {
  clearSnooze,
  inQuietHours,
  isSnoozed,
  loadCaptureSettings,
  saveCaptureSettings,
  type CaptureSettings,
} from "@/lib/capture";
import {
  disablePush,
  enablePush,
  fetchPushPrefs,
  pushSupport,
  savePushPrefs,
  type PushPrefs,
} from "@/lib/push";

/**
 * Push notifications for Quick Capture. Separate from the in-app widget on
 * purpose: the widget only works while the app is open, push is what reaches
 * you when it isn't.
 */
export function PushSection() {
  const [prefs, setPrefs] = useState<PushPrefs | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [support, setSupport] = useState<ReturnType<typeof pushSupport> | null>(null);

  useEffect(() => {
    setSupport(pushSupport());
    fetchPushPrefs().then(setPrefs).catch(() => {});
  }, []);
  if (!prefs) return null;

  async function toggle(on: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      if (on) {
        const r = await enablePush();
        setMsg(r.message);
        if (r.ok) setPrefs({ ...prefs!, enabled: true });
      } else {
        await disablePush();
        setPrefs({ ...prefs!, enabled: false });
        setMsg("Push is off.");
      }
    } finally {
      setBusy(false);
    }
  }

  function update(next: PushPrefs) {
    setPrefs(next);
    savePushPrefs(next).catch((e) => setMsg(String(e.message ?? e)));
  }

  return (
    <div className="card mb-6 p-4">
      <h2 className="mb-1 font-semibold">Notifications on your phone</h2>
      <p className="mb-3 text-sm text-muted">
        Quick Capture only prompts while the app is open. This is what reaches you when it isn&apos;t. You&apos;ll
        only hear from us about a slot you <b>forgot</b> — log as you go and it stays quiet.
      </p>

      {support && !support.ok && support.reason === "needs-install" && (
        <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          On iPhone, Apple only allows notifications for an installed app. Tap <b>Share</b> → <b>Add to Home Screen</b>,
          open DayMax from the icon, then come back here.
        </p>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={prefs.enabled}
          disabled={busy || (support ? !support.ok : false)}
          onChange={(e) => void toggle(e.target.checked)}
          className="mt-0.5"
        />
        <span><b>Send me prompts</b>{busy && <span className="ml-1 text-faint">…</span>}</span>
      </label>

      {prefs.enabled && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted">
          Quiet hours
          <select value={prefs.quietFrom} onChange={(e) => update({ ...prefs, quietFrom: Number(e.target.value) })} className="rounded-lg border bg-surface px-2 py-1 text-sm text-ink">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
          to
          <select value={prefs.quietTo} onChange={(e) => update({ ...prefs, quietTo: Number(e.target.value) })} className="rounded-lg border bg-surface px-2 py-1 text-sm text-ink">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
          · at most one every
          <select value={prefs.minGapMin} onChange={(e) => update({ ...prefs, minGapMin: Number(e.target.value) })} className="rounded-lg border bg-surface px-2 py-1 text-sm text-ink">
            {[15, 30, 60, 120, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60}h`}</option>)}
          </select>
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </div>
  );
}

/** Quick Capture: the every-15-minutes prompt. */
export function CaptureSection() {
  const [s, setS] = useState<CaptureSettings | null>(null);
  const [perm, setPerm] = useState<string>("default");

  useEffect(() => {
    setS(loadCaptureSettings());
    if (typeof Notification !== "undefined") setPerm(Notification.permission);
  }, []);
  if (!s) return null;

  function update(next: CaptureSettings) {
    setS(next);
    saveCaptureSettings(next);
  }

  return (
    <div className="card mb-6 p-4">
      <h2 className="mb-1 font-semibold">Quick Capture</h2>
      <p className="mb-3 text-sm text-muted">
        A small box asks what you&apos;re doing as each 15-minute slot closes. Type a few words, press Enter. Press
        <b> ⌘/Ctrl+J</b> anywhere to open it on demand. Step away for an hour and it queues the missed slots so you
        clear them in four keystrokes.
      </p>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={s.enabled} onChange={(e) => update({ ...s, enabled: e.target.checked })} className="mt-0.5" />
        <span><b>Enabled</b> — show the capture box</span>
      </label>

      {/* Live diagnostic + a "show it now" button. Answers the "is
          this thing working" question directly instead of leaving you
          to guess why the popup went quiet. */}
      {s.enabled && <CaptureStatus s={s} />}

      {s.enabled && (
        <div className="mt-3 space-y-3 border-t pt-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="text-xs text-muted">
              Catch up on the last
              <select
                value={s.lookbackMin}
                onChange={(e) => update({ ...s, lookbackMin: Number(e.target.value) })}
                className="ml-1 rounded-lg border bg-surface px-2 py-1 text-sm text-ink"
              >
                {[30, 60, 120, 240, 480].map((m) => (
                  <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hours`}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              at most
              <select
                value={s.maxQueue}
                onChange={(e) => update({ ...s, maxQueue: Number(e.target.value) })}
                className="ml-1 rounded-lg border bg-surface px-2 py-1 text-sm text-ink"
              >
                {[4, 8, 12, 20].map((n) => (
                  <option key={n} value={n}>{n} slots</option>
                ))}
              </select>
            </label>
          </div>

          {/* Quiet hours can be turned OFF now via an explicit toggle.
              inQuietHours() already returns false when from === to
              (see lib/capture.ts and its tests), so the OFF state is
              simply setting both to 0 -- no schema change needed. */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={s.quietFrom !== s.quietTo}
                onChange={(e) => {
                  if (e.target.checked) {
                    // re-enable at sensible defaults
                    update({ ...s, quietFrom: 22, quietTo: 7 });
                  } else {
                    update({ ...s, quietFrom: 0, quietTo: 0 });
                  }
                }}
              />
              <b>Quiet hours</b>
            </label>
            {s.quietFrom !== s.quietTo && (
              <>
                <select value={s.quietFrom} onChange={(e) => update({ ...s, quietFrom: Number(e.target.value) })} className="rounded-lg border bg-surface px-2 py-1 text-sm text-ink">
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                </select>
                to
                <select value={s.quietTo} onChange={(e) => update({ ...s, quietTo: Number(e.target.value) })} className="rounded-lg border bg-surface px-2 py-1 text-sm text-ink">
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                </select>
                <span className="text-faint">— no prompts while you&apos;re asleep</span>
              </>
            )}
            {s.quietFrom === s.quietTo && (
              <span className="text-faint">— off (Quick Capture prompts at any hour)</span>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={s.notify}
              onChange={(e) => {
                const on = e.target.checked;
                if (on && typeof Notification !== "undefined" && Notification.permission === "default") {
                  void Notification.requestPermission().then((p) => {
                    setPerm(p);
                    update({ ...s, notify: p === "granted" });
                  });
                } else {
                  update({ ...s, notify: on });
                }
              }}
              className="mt-0.5"
            />
            <span>
              <b>Desktop notifications</b> — ping me when the tab isn&apos;t focused
              {perm === "denied" && <span className="ml-1 text-warn">(blocked in your browser settings)</span>}
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

/**
 * "Is Quick Capture actually working right now?" -- ticks every 15s,
 * reports the four things that can silence it (disabled / quiet hours /
 * snoozed / nothing to catch up on). Has a 'Show it now' button that
 * clears the snooze and dispatches the same custom event a save fires,
 * which triggers the widget's tick to run.
 */
function CaptureStatus({ s }: { s: CaptureSettings }) {
  const [now, setNow] = useState(new Date());
  const [snooze, setSnooze] = useState(false);
  useEffect(() => {
    const tick = () => { setNow(new Date()); setSnooze(isSnoozed()); };
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);
  const quiet = inQuietHours(now.getHours(), s.quietFrom, s.quietTo);
  const okState = !quiet && !snooze;
  return (
    <div className="mt-3 rounded-lg border bg-surface-2 px-3 py-2 text-xs">
      <p className="mb-1 font-semibold text-muted">Status</p>
      <ul className="space-y-0.5">
        <li className={s.enabled ? "text-ok" : "text-warn"}>
          {s.enabled ? "✓ Enabled" : "✗ Disabled (tick the box above)"}
        </li>
        <li className={quiet ? "text-warn" : "text-muted"}>
          {s.quietFrom === s.quietTo
            ? "✓ Quiet hours off — will prompt at any hour"
            : quiet
              ? `✗ In quiet hours (${String(s.quietFrom).padStart(2, "0")}:00 → ${String(s.quietTo).padStart(2, "0")}:00) — silent until it ends`
              : `✓ Outside quiet hours (${String(s.quietFrom).padStart(2, "0")}:00 → ${String(s.quietTo).padStart(2, "0")}:00)`}
        </li>
        <li className={snooze ? "text-warn" : "text-muted"}>
          {snooze ? "✗ Snoozed — you tapped Later or Not today" : "✓ Not snoozed"}
        </li>
        <li className="text-faint">Ticker wakes every 60s. Also try ⌘/Ctrl+J to open on demand.</li>
      </ul>
      {(snooze || !okState) && (
        <button
          onClick={() => { clearSnooze(); window.dispatchEvent(new Event("daymax-day-saved")); setSnooze(false); }}
          className="mt-2 rounded-lg border border-accent bg-accent-soft px-3 py-1 text-xs font-medium text-accent hover:bg-accent"
        >
          Clear snooze &amp; try now
        </button>
      )}
    </div>
  );
}
