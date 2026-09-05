"use client";

/**
 * First run: pick a handle. New accounts get a provisional one from their email
 * prefix, so this is a choice rather than a blocker — but until they pick, the
 * gate in layout keeps sending them here.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchMyUsername, isUsernameAvailable, setUsername } from "@/lib/friends";
import { fetchProfile, updateProfile } from "@/lib/data";

type Check = "idle" | "checking" | "free" | "taken" | "invalid";

const RULES = /^[a-z0-9_]{3,20}$/;

export default function WelcomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [check, setCheck] = useState<Check>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
      } catch {
        // not signed in, or migration 0021 hasn't run — let them past either way
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  // debounce the availability check so we're not hammering the DB per keystroke
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

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setUsername(handle);
      if (name.trim()) await updateProfile({ displayName: name.trim() }).catch(() => {});
      router.replace("/");
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted">One moment…</p>;

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-bold">Welcome to DayMax</h1>
      <p className="mb-5 text-sm text-muted">Pick a handle so friends can find you. You can change it later in Settings.</p>

      <div className="card space-y-4 p-5">
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

        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <button onClick={() => void save()} disabled={busy || check !== "free"} className="btn-primary w-full">
          {busy ? "Saving…" : "Continue"}
        </button>

        <p className="text-xs text-faint">
          You&apos;ll be discoverable by name or handle so friends can add you. Turn that off any time in Settings →
          Profile. Under-18 accounts never appear in search.
        </p>
      </div>
    </div>
  );
}
