"use client";

/**
 * "Add DayMax to your home screen."
 *
 * Shown once, and only to someone who has actually logged something — asking a
 * stranger to install an app they haven't used yet is how you get dismissed
 * forever. Chrome/Android gets the real install dialog via beforeinstallprompt;
 * iOS Safari has no such API, so it gets the Share-button instructions instead.
 */

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED = "daymax-install-dismissed";

export default function InstallPrompt({ canPrompt }: { canPrompt: boolean }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!canPrompt) return;
    try {
      if (localStorage.getItem(DISMISSED) === "1") return;
    } catch {
      return;
    }
    // already installed? standalone display-mode is the reliable signal
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const onPrompt = (e: Event) => {
      e.preventDefault(); // stop Chrome's own mini-infobar; we choose the moment
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS never fires that event, so detect it and explain the manual route
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua)) {
      setIosHint(true);
      setShow(true);
    }
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [canPrompt]);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {}
  }

  if (!show) return null;

  return (
    <div className="card mb-6 border-2 border-accent-soft p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Put DayMax on your home screen</h2>
          <p className="text-sm text-muted">
            {iosHint ? (
              <>
                Tap <b>Share</b> in Safari, then <b>Add to Home Screen</b>. Quick Capture can only prompt you while
                the app is open — on the home screen it behaves like a real app.
              </>
            ) : (
              <>Opens straight to today&apos;s log, and Quick Capture can actually reach you.</>
            )}
          </p>
        </div>
        {!iosHint && deferred && (
          <button
            onClick={async () => {
              await deferred.prompt();
              await deferred.userChoice;
              dismiss();
            }}
            className="btn-primary"
          >
            Install
          </button>
        )}
        <button onClick={dismiss} className="btn-ghost">
          {iosHint ? "Got it" : "Not now"}
        </button>
      </div>
    </div>
  );
}
