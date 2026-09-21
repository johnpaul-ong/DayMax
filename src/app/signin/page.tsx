"use client";

/**
 * Sign in / sign up. Rebuilt on feedback that the old page led with a
 * three-tab picker where Sign up was buried behind Password, so a
 * first-time visitor tried imaginary credentials and got a stock error.
 *
 * New layout:
 *   * ONE pitch sentence at the top — 'what is this'
 *   * A tiny visual hook (the year strip mini) — 'this is what you get'
 *   * OAuth (Google / Apple) as the fastest path in
 *   * Email + password as the fallback, defaulting to Sign up for a
 *     first-time visitor. Existing users flip to Sign in via a link.
 *   * Magic link renamed to 'Email me a link' — 'magic' is jargon.
 *
 * OAuth buttons fire supabase.auth.signInWithOAuth; if that provider
 * isn't configured in Supabase's dashboard the call errors with a
 * legible message and we surface it.
 */

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "signup" | "signin" | "link";

export default function SignInPage() {
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"ok" | "err" | "info">("info");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "link") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${location.origin}/auth/callback` },
        });
        if (error) {
          setMsgTone("err");
          setMsg(error.message);
        } else {
          setMsgTone("ok");
          setMsg("Check your email for the sign-in link. (Check spam too — the link expires in about an hour.)");
        }
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/auth/callback` },
        });
        if (error) {
          setMsgTone("err");
          setMsg(error.message);
        } else if (data.user && data.user.identities && data.user.identities.length === 0) {
          // Supabase deliberately doesn't say "this address already exists".
          setMsgTone("info");
          setMsg("If that address doesn't already have an account, a confirmation email is on its way. Otherwise, sign in or reset your password.");
        } else {
          setMsgTone("ok");
          setMsg("Account created. Check your email to confirm — the link expires, so use it soon. (Check spam too.)");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setMsgTone("err");
          setMsg(error.message);
        } else {
          // Open-redirect guard: `startsWith("/")` alone accepts
          // "//attacker.com" and "/\attacker.com" (protocol-relative
          // and browser-quirk URLs), sending the newly-authenticated
          // user off-site. Only accept a next that is a plain
          // same-origin path.
          const raw = new URLSearchParams(location.search).get("next");
          const next = raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/";
          location.href = next;
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function oauth(provider: "google" | "apple") {
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${location.origin}/auth/callback` },
      });
      if (error) {
        setMsgTone("err");
        setMsg(`${provider} sign-in isn't set up: ${error.message}`);
        setBusy(false);
      }
      // on success the browser navigates away; no state to reset.
    } catch (e: any) {
      setMsgTone("err");
      setMsg(String(e.message ?? e));
      setBusy(false);
    }
  }

  const isSignup = mode === "signup";
  const isLink = mode === "link";
  const submitLabel = isLink ? "Email me a link" : isSignup ? "Create account" : "Sign in";

  return (
    <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-md flex-col justify-center py-10">
      {/* Pitch + hook. The old page landed cold with a philosophy
          statement; this actually says what the app does. */}
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          Day<span className="text-accent">Max</span>
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Track your day in 15-minute slots. Compare with friends. See the shape of your year.
        </p>
        <YearStripHook />
      </div>

      <div className="card p-5">
        {/* Fast paths first: OAuth buttons at the top so the whole
            email/password stack becomes a fallback. */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => void oauth("google")}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl border bg-surface px-4 py-2.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
          >
            <GoogleLogo /> Continue with Google
          </button>
          <button
            onClick={() => void oauth("apple")}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl border bg-surface px-4 py-2.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
          >
            <AppleLogo /> Continue with Apple
          </button>
        </div>

        <div className="my-4 flex items-center gap-3 text-[10px] uppercase tracking-wider text-faint">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-muted">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm"
            />
          </label>

          {!isLink && (
            <label className="block">
              <span className="text-xs font-medium text-muted">Password</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete={isSignup ? "new-password" : "current-password"}
                placeholder={isSignup ? "8+ characters" : "Your password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm"
              />
            </label>
          )}

          <button
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-semibold text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
          >
            {busy && <Spinner />}
            {busy ? "Please wait…" : submitLabel}
          </button>
        </form>

        {msg && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-sm ${
              msgTone === "ok"
                ? "bg-ok-soft text-ok"
                : msgTone === "err"
                ? "bg-danger-soft text-danger"
                : "bg-surface-2 text-muted"
            }`}
          >
            {msg}
          </p>
        )}

        {/* Secondary paths, plain-language and demoted. */}
        <div className="mt-4 flex flex-col items-center gap-1.5 border-t pt-3 text-xs">
          {isSignup ? (
            <>
              <button onClick={() => { setMode("signin"); setMsg(null); }} className="text-muted hover:text-accent">
                Already have an account? <span className="font-semibold underline">Sign in</span>
              </button>
              <button onClick={() => { setMode("link"); setMsg(null); }} className="text-faint hover:text-accent">
                Or email me a sign-in link
              </button>
            </>
          ) : mode === "signin" ? (
            <>
              <button onClick={() => { setMode("signup"); setMsg(null); }} className="text-muted hover:text-accent">
                New here? <span className="font-semibold underline">Create an account</span>
              </button>
              <button
                onClick={async () => {
                  if (!email) { setMsgTone("err"); setMsg("Enter your email above first."); return; }
                  const { error } = await supabase.auth.resetPasswordForEmail(email, {
                    redirectTo: `${location.origin}/auth/callback`,
                  });
                  setMsgTone(error ? "err" : "ok");
                  setMsg(error ? error.message : "Password reset link sent — check your email.");
                }}
                className="text-faint hover:text-accent"
              >
                Forgot your password?
              </button>
              <button onClick={() => { setMode("link"); setMsg(null); }} className="text-faint hover:text-accent">
                Or email me a sign-in link
              </button>
            </>
          ) : (
            <button onClick={() => { setMode("signup"); setMsg(null); }} className="text-muted hover:text-accent">
              ← Back to sign up
            </button>
          )}
        </div>
      </div>

      <p className="mx-auto mt-4 max-w-sm text-center text-[10px] text-faint">
        Private by default. Nothing you log is public unless you choose to share it. Under-18 accounts never appear in search.
      </p>
    </div>
  );
}

/**
 * A live "year strip" hook: 40 stacked column bars in the app's
 * category colours, each split into three sub-slots that slowly
 * cycle through the palette on staggered timers. Purely decorative,
 * fetches nothing, but ambient enough that landing on the sign-in
 * page feels like watching a live board rather than a static gradient.
 *
 * Animation is a single CSS keyframe (hue-rotate + brightness pulse)
 * with the delay staggered by column index, so the effect ripples
 * left-to-right across the strip. Sub-slot heights + starting
 * colours stay deterministic so the SSR / hydration match is
 * pixel-exact.
 */
function YearStripHook() {
  const cats = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  return (
    <>
      <style>{`
        /* Faster hue cycle -- was 8s (one wave every ~4s), now 3s
           so multiple colour shifts happen per second across the
           strip. Kept stepwise so each cell 'flickers' between
           palettes rather than smoothly interpolating, which reads
           more like real day cells changing state. */
        @keyframes daymax-signin-strip {
          0%,  19% { filter: hue-rotate(0deg)   brightness(1);    opacity: 0.9; }
          20%, 39% { filter: hue-rotate(60deg)  brightness(1.15); opacity: 1;   }
          40%, 59% { filter: hue-rotate(150deg) brightness(0.95); opacity: 0.85;}
          60%, 79% { filter: hue-rotate(240deg) brightness(1.1);  opacity: 1;   }
          80%,100% { filter: hue-rotate(320deg) brightness(1);    opacity: 0.9; }
        }
        @keyframes daymax-signin-strip-flow {
          0%   { transform: translateY(0);    }
          50%  { transform: translateY(-2px); }
          100% { transform: translateY(0);    }
        }
        @media (prefers-reduced-motion: reduce) {
          .daymax-signin-cell, .daymax-signin-col { animation: none !important; }
        }
      `}</style>
      <div className="mx-auto mt-4 flex h-14 max-w-[340px] gap-[2px] overflow-hidden rounded-md" aria-hidden="true">
        {Array.from({ length: 40 }, (_, i) => {
          // Richer per-column split: 3-6 stripes per column (was
          // 2-4), sizes pseudo-randomly 8-30 % of column height,
          // normalised to 100. Deterministic (seeded by index) so
          // SSR/hydration match, but every column now shows more
          // segments and reads like a busier day.
          const seed = (i * 7 + 3) % 100;
          const stripeCount = 3 + ((seed * 3) % 4); // 3, 4, 5, or 6
          const rawHeights = Array.from({ length: stripeCount }, (_, j) => {
            const r = ((seed * (j * 13 + 17) + 41) % 22) + 8; // 8..29
            return r;
          });
          const total = rawHeights.reduce((s, v) => s + v, 0);
          const heights = rawHeights.map((h) => Math.round((h / total) * 100));
          const parts = heights.map((h, j) => ({
            c: cats[(seed * (j * 7 + 3) + j) % cats.length],
            h,
          }));
          // Stagger the hue-cycle by column so the wave travels
          // across the strip. 40 cols × 90 ms = one full pass every
          // ~3.6 s at 8 s cycle length.
          const colDelay = `${(i * -0.09).toFixed(2)}s`;
          return (
            <div
              key={i}
              className="daymax-signin-col flex h-full flex-1 flex-col overflow-hidden"
              style={{
                minWidth: 0,
                animation: `daymax-signin-strip-flow 3.2s ease-in-out ${colDelay} infinite`,
              }}
            >
              {parts.map((p, j) => (
                <div
                  key={j}
                  className="daymax-signin-cell"
                  style={{
                    height: `${p.h}%`,
                    background: `var(--cat-${p.c})`,
                    // 3 s cycle (was 8 s) so shifts happen a few
                    // times a second across the strip. Stagger by
                    // column and by stripe so each cell 'flickers'
                    // out of phase with its neighbours -- reads as
                    // a busy live picture, not a synchronous wave.
                    animation: `daymax-signin-strip 3s steps(5, end) ${((i * 0.05) + j * 0.17).toFixed(2)}s infinite`,
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.5-1.72 4.4-5.5 4.4a6.5 6.5 0 1 1 0-13 6 6 0 0 1 4.2 1.7l2.8-2.7A9.9 9.9 0 0 0 12 2a10 10 0 1 0 0 20c5.7 0 9.6-4 9.6-9.7 0-.7-.1-1.3-.2-2H12z"/>
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M16.5 12.6c0-2.7 2.2-4 2.3-4.1-1.3-1.8-3.2-2.1-3.9-2.1-1.7-.2-3.2 1-4.1 1s-2.2-1-3.5-1c-1.8 0-3.5 1-4.4 2.7-1.9 3.3-.5 8.1 1.3 10.8.9 1.3 2 2.7 3.4 2.7 1.4 0 1.9-.9 3.5-.9s2.1.9 3.5.9c1.5 0 2.4-1.3 3.3-2.6 1-1.5 1.5-3 1.5-3.1-.1 0-2.9-1.1-2.9-4.3zM14 4.4c.8-.9 1.3-2.2 1.1-3.4-1.1 0-2.4.7-3.2 1.6-.7.8-1.3 2.1-1.1 3.3 1.2.1 2.4-.6 3.2-1.5z"/>
    </svg>
  );
}
