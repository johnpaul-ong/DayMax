"use client";

/**
 * First run, in three short steps: who you are, the numbers that power the
 * "Your life" card, and how the app should look. Everything here is also
 * editable later in Settings — nothing is a one-shot decision.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchMyUsername, isUsernameAvailable, setUsername } from "@/lib/friends";
import { fetchProfile, updateProfile } from "@/lib/data";
import { COUNTRIES, lifeStats } from "@/lib/life";
import { applyTheme, saveTheme, saveThemeToAccount, THEMES, type ThemeName } from "@/lib/theme";

type Check = "idle" | "checking" | "free" | "taken" | "invalid";
const RULES = /^[a-z0-9_]{3,20}$/;
const ACCENTS = ["#4f6ef7", "#16a34a", "#dc2626", "#f59e0b", "#a78bfa", "#ec4899", "#14b8a6", "#0ea5e9"];

export default function WelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // step 1 — you
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [check, setCheck] = useState<Check>("idle");

  // step 2 — the numbers
  const [birthDate, setBirthDate] = useState("");
  const [country, setCountry] = useState("");

  // step 3 — look
  const [theme, setTheme] = useState<ThemeName>("light");
  const [accent, setAccent] = useState<string | null>(null);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [me, profile] = await Promise.all([fetchMyUsername(), fetchProfile().catch(() => null)]);
        if (me.chosen) {
          router.replace("/");
          return;
        }
        setHandle(me.username ?? "");
        setName(profile?.displayName ?? "");
        setBirthDate(profile?.birthDate ?? "");
        setCountry(profile?.country ?? "");
      } catch {
        // not signed in, or migration 0021 hasn't run — don't trap anyone here
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  // debounced availability check, so we're not hitting the DB per keystroke
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!handle) return void setCheck("idle");
    if (!RULES.test(handle)) return void setCheck("invalid");
    setCheck("checking");
    debounce.current = setTimeout(() => {
      isUsernameAvailable(handle)
        .then((free) => setCheck(free ? "free" : "taken"))
        .catch(() => setCheck("idle"));
    }, 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [handle]);

  // preview the theme live as it's picked — reverted on unmount if not saved
  function previewTheme(t: ThemeName, a: string | null) {
    setTheme(t);
    setAccent(a);
    applyTheme(t, a);
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await setUsername(handle);
      await updateProfile({
        displayName: name.trim() || null,
        birthDate: birthDate || null,
        country: country || null,
      }).catch(() => {});
      saveTheme(theme, accent);
      void saveThemeToAccount(theme, accent);
      router.replace("/");
    } catch (e: any) {
      setError(String(e.message ?? e));
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted">One moment…</p>;

  const life = birthDate ? lifeStats(birthDate, country || null) : null;

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-bold">
        Welcome to Day<span className="text-accent">Max</span>
      </h1>
      <p className="mb-4 text-sm text-muted">Three quick things. All of it is editable later in Settings.</p>

      <div className="mb-4 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-surface-2"}`} />
        ))}
      </div>

      <div className="card space-y-4 p-5">
        {step === 0 && (
          <>
            <h2 className="font-semibold">Who are you?</h2>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wider text-faint">Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="What people should call you"
                className="mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wider text-faint">Username</span>
              <div className="mt-1 flex items-center gap-2 rounded-lg border bg-surface px-3 focus-within:ring-2 focus-within:ring-accent">
                <span className="text-muted">@</span>
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  placeholder="yourhandle"
                  maxLength={20}
                  autoFocus
                  className="w-full bg-transparent py-2 text-sm outline-none"
                />
              </div>
              <p className="mt-1 h-4 text-xs">
                {check === "checking" && <span className="text-faint">checking…</span>}
                {check === "free" && <span className="text-ok">@{handle} is free ✓</span>}
                {check === "taken" && <span className="text-danger">@{handle} is taken</span>}
                {check === "invalid" && <span className="text-warn">3–20 characters: letters, numbers, underscores</span>}
              </p>
            </label>
            <button onClick={() => setStep(1)} disabled={check !== "free"} className="btn-primary w-full">
              Next
            </button>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="font-semibold">A couple of numbers</h2>
            <p className="-mt-2 text-sm text-muted">
              These power the &ldquo;Your life&rdquo; card — how much of your expected life you&apos;ve used, and how
              many weeks are left. Private, and skippable.
            </p>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wider text-faint">Date of birth</span>
              <input
                type="date"
                value={birthDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setBirthDate(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wider text-faint">Country</span>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm"
              >
                <option value="">— pick one —</option>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-faint">Sets the life-expectancy figure. World average if left blank.</span>
            </label>

            {life && (
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
                You&apos;re <b>{life.ageYears.toFixed(1)}</b> — <b>{life.percentLived.toFixed(1)}%</b> of a{" "}
                {life.expectancy.toFixed(1)}-year life{country ? ` in ${country}` : ""}, with{" "}
                <b>~{Math.round(life.weeksLeft).toLocaleString()} weeks</b> left.
              </p>
            )}

            <div className="flex gap-2">
              <button onClick={() => setStep(0)} className="btn-ghost">Back</button>
              <button onClick={() => setStep(2)} className="btn-primary flex-1">
                {birthDate ? "Next" : "Skip"}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="font-semibold">Pick your team</h2>
            <p className="-mt-2 text-sm text-muted">
              Your theme is your team. Every pursuit keeps score of Light vs Midnight vs Cottage, so this is the only
              tribal decision you have to make. Changes as you tap.
            </p>

            <div className="grid grid-cols-3 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.name}
                  onClick={() => previewTheme(t.name, accent)}
                  className={`rounded-xl border-2 px-3 py-4 text-sm font-medium transition ${
                    theme === t.name ? "border-accent bg-accent-soft text-accent" : "border-transparent bg-surface-2 text-muted"
                  }`}
                >
                  <span className="block text-xl">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
            <p className="-mt-1 text-xs text-faint">You can switch sides later in Settings.</p>

            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-faint">Accent</span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <button
                  onClick={() => previewTheme(theme, null)}
                  className={`h-8 rounded-full border-2 px-3 text-xs ${accent === null ? "border-accent font-semibold" : "border-transparent bg-surface-2 text-muted"}`}
                >
                  default
                </button>
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    onClick={() => previewTheme(theme, c)}
                    style={{ background: c }}
                    className={`h-8 w-8 rounded-full border-2 ${accent === c ? "border-ink" : "border-transparent"}`}
                    aria-label={`Accent ${c}`}
                  />
                ))}
              </div>
            </div>

            {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="btn-ghost">Back</button>
              <button onClick={() => void finish()} disabled={busy} className="btn-primary flex-1">
                {busy ? "Setting up…" : "Start tracking"}
              </button>
            </div>
          </>
        )}
      </div>

      <p className="mt-3 text-xs text-faint">
        You&apos;ll be findable by name or @handle so friends can add you — turn that off any time in Settings.
        Under-18 accounts never appear in search.
      </p>
    </div>
  );
}
