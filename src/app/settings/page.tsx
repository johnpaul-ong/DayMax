"use client";

/**
 * Settings: assign each parent category to a ranking bucket.
 * Defaults: productive = Work + Sports, brainrot = Other + Leisure.
 * (Share rules and invites arrive with Phase 3.)
 */

import { useEffect, useState } from "react";
import { CATEGORIES, type Bucket } from "@/lib/categories";
import { loadHiddenTabs, NAV_TABS, saveHiddenTabs } from "../nav-links";
import { fetchBucketSettings, fetchProfile, saveBucketSettings, updateProfile } from "@/lib/data";
import { COUNTRIES, lifeStats } from "@/lib/life";
import { PROFILE_SECTIONS, type MyVisibility, type ProfileSection } from "@/lib/friends";
import {
  applyTheme,
  DEFAULT_BUCKET_COLORS,
  loadBucketColors,
  loadTheme,
  saveBucketColors,
  saveTheme,
  THEMES,
  type BucketColors,
  type ThemeName,
} from "@/lib/theme";
import type { BucketSettings } from "@/lib/types";

const BUCKETS: Bucket[] = ["productive", "brainrot", "other"];

function AppearanceSection() {
  const [theme, setTheme] = useState<ThemeName>("light");
  const [accent, setAccent] = useState<string | null>(null);

  useEffect(() => {
    const t = loadTheme();
    setTheme(t.theme);
    setAccent(t.accent);
  }, []);

  function update(nextTheme: ThemeName, nextAccent: string | null) {
    setTheme(nextTheme);
    setAccent(nextAccent);
    applyTheme(nextTheme, nextAccent);
    saveTheme(nextTheme, nextAccent);
    import("@/lib/theme").then((t) => void t.saveThemeToAccount(nextTheme, nextAccent)); // follows your account
  }

  return (
    <div className="card mb-6 p-4">
      <h2 className="mb-1 font-semibold">Appearance</h2>
      <p className="mb-3 text-sm text-muted">Saved on this device.</p>
      <div className="mb-3 flex gap-2">
        {THEMES.map((t) => (
          <button
            key={t.name}
            onClick={() => update(t.name, accent)}
            className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${theme === t.name ? "ring-2 ring-accent" : "hover:bg-surface-2"}`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <label className="text-sm text-muted">Accent color</label>
        <input
          type="color"
          value={accent ?? "#4f6ef7"}
          onChange={(e) => update(theme, e.target.value)}
          className="h-8 w-12 cursor-pointer rounded-lg border bg-surface"
        />
        {accent && (
          <button onClick={() => update(theme, null)} className="text-sm text-accent hover:underline">
            Reset to theme default
          </button>
        )}
      </div>
    </div>
  );
}

function BucketColorRows() {
  const [colors, setColors] = useState<BucketColors | null>(null);

  useEffect(() => {
    setColors(loadBucketColors());
  }, []);
  if (!colors) return null;

  function set(key: keyof BucketColors, value: string) {
    const next = { ...colors!, [key]: value };
    setColors(next);
    saveBucketColors(next);
  }

  const isDefault = JSON.stringify(colors) === JSON.stringify(DEFAULT_BUCKET_COLORS);
  return (
    <div className="card mb-3 p-4">
      <p className="mb-2 text-sm text-muted">Bucket colors — used in charts, the year view and home</p>
      <div className="flex flex-wrap items-center gap-4">
        {(["productive", "brainrot", "other"] as const).map((k) => (
          <label key={k} className="inline-flex items-center gap-2 text-sm capitalize">
            <input
              type="color"
              value={colors[k]}
              onChange={(e) => set(k, e.target.value)}
              className="h-8 w-12 cursor-pointer rounded-lg border bg-surface"
            />
            {k}
          </label>
        ))}
        {!isDefault && (
          <button
            onClick={() => {
              setColors({ ...DEFAULT_BUCKET_COLORS });
              saveBucketColors({ ...DEFAULT_BUCKET_COLORS });
            }}
            className="text-sm text-accent hover:underline"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

function NavigationSection() {
  const [hidden, setHidden] = useState<string[] | null>(null);
  useEffect(() => setHidden(loadHiddenTabs()), []);
  if (hidden === null) return null;

  function toggle(href: string) {
    const next = hidden!.includes(href) ? hidden!.filter((h) => h !== href) : [...hidden!, href];
    setHidden(next);
    saveHiddenTabs(next);
  }

  return (
    <div className="card mb-6 p-4">
      <h2 className="mb-1 font-semibold">Navigation</h2>
      <p className="mb-3 text-sm text-muted">
        Not a lifter? Hide the whole tab. DayMax is your app — show only what you track. (Saved on this device;
        Settings can&apos;t be hidden, for obvious reasons.)
      </p>
      <div className="flex flex-wrap gap-2">
        {NAV_TABS.filter((t) => t.href !== "/settings").map((t) => (
          <button
            key={t.href}
            onClick={() => toggle(t.href)}
            className={`rounded-full border px-3 py-1.5 text-sm ${!hidden.includes(t.href) ? "bg-accent-soft font-semibold text-accent" : "text-muted line-through"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LabelRenameSection() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function rename() {
    setBusy(true);
    setMsg(null);
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data, error } = await supabase
        .from("day_entries")
        .update({ label: to.trim() || null })
        .eq("label", from.trim())
        .select("date");
      if (error) throw error;
      setMsg(`Renamed ${data?.length ?? 0} slots.`);
      setFrom("");
      setTo("");
    } catch (e: any) {
      setMsg(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb-6 p-4">
      <h2 className="mb-1 font-semibold">Rename a label</h2>
      <p className="mb-3 text-sm text-muted">Fix a typo or merge labels across every day at once (e.g. &ldquo;thesis writing&rdquo; → &ldquo;thesis&rdquo;). Leave the new label empty to clear it.</p>
      <div className="flex flex-wrap items-end gap-2">
        <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Current label" className="w-40 rounded-lg border bg-surface px-2 py-2 text-sm" />
        <span className="pb-2 text-muted">→</span>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="New label" className="w-40 rounded-lg border bg-surface px-2 py-2 text-sm" />
        <button onClick={() => void rename()} disabled={busy || !from.trim()} className="btn-primary">
          {busy ? "Renaming…" : "Rename everywhere"}
        </button>
      </div>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </div>
  );
}

/**
 * Two audiences, two lists: what anyone can see, and what friends can see.
 * Public is the default — going private hides the page from non-friends
 * entirely, which is why the public column greys out when it's off.
 */
function ProfileVisibilitySection() {
  const [vis, setVis] = useState<MyVisibility | null>(null);
  const [discoverable, setDiscoverableState] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    import("@/lib/friends")
      .then((f) => f.fetchMyVisibility())
      .then(setVis)
      .catch(() => setVis(null));
    import("@/lib/friends")
      .then((f) => f.fetchDiscoverable())
      .then(setDiscoverableState)
      .catch(() => {});
  }, []);

  if (!vis) return null;

  function save(next: MyVisibility) {
    setVis(next);
    import("@/lib/friends")
      .then((f) => f.saveMyVisibility(next))
      .then(() => setMsg("Saved."))
      .catch((e) => setMsg(String(e.message ?? e)));
  }

  function toggle(which: "publicSections" | "friendSections", key: ProfileSection) {
    const cur = vis![which];
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    save({ ...vis!, [which]: next });
  }

  return (
    <div className="card mb-6 p-4">
      <h2 className="mb-1 font-semibold">Who can see your profile</h2>
      <p className="mb-3 text-sm text-muted">
        Your page lives at a link anyone can open — unless you make it private. Friends and everyone else get their
        own list of what shows.
      </p>

      <div className="mb-4 flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
        <button
          onClick={() => save({ ...vis, isPublic: true })}
          className={`flex-1 rounded-lg px-3 py-2 ${vis.isPublic ? "bg-surface font-semibold" : "text-muted"}`}
        >
          Public
          <span className="block text-xs font-normal text-faint">Anyone signed in can open it</span>
        </button>
        <button
          onClick={() => save({ ...vis, isPublic: false })}
          className={`flex-1 rounded-lg px-3 py-2 ${!vis.isPublic ? "bg-surface font-semibold" : "text-muted"}`}
        >
          Private
          <span className="block text-xs font-normal text-faint">Friends only</span>
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2">Section</th>
              <th className="px-3 py-2 text-center">Everyone</th>
              <th className="px-3 py-2 text-center">Friends</th>
            </tr>
          </thead>
          <tbody>
            {PROFILE_SECTIONS.map((o) => (
              <tr key={o.key} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <span className="font-medium">{o.label}</span>
                  <span className="block text-xs text-faint">{o.hint}</span>
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={vis.isPublic && vis.publicSections.includes(o.key)}
                    disabled={!vis.isPublic}
                    onChange={() => toggle("publicSections", o.key)}
                    className="h-4 w-4 disabled:opacity-30"
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={vis.friendSections.includes(o.key)}
                    onChange={() => toggle("friendSections", o.key)}
                    className="h-4 w-4"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-faint">
        What you wrote in each 15-minute slot is never shown by any of these — labels only ever go to someone you
        explicitly set to &ldquo;raw labels&rdquo; on a shared track.
      </p>

      {discoverable !== null && (
        <label className="mt-3 flex items-start gap-2 border-t pt-3 text-sm">
          <input
            type="checkbox"
            checked={discoverable}
            onChange={(e) => {
              setDiscoverableState(e.target.checked);
              import("@/lib/friends")
                .then((f) => f.setDiscoverable(e.target.checked))
                .then(() => setMsg("Saved."))
                .catch((ex) => setMsg(String(ex.message ?? ex)));
            }}
            className="mt-0.5"
          />
          <span>
            <b>Discoverable</b> — let people find you in search by name or @handle. On by default; turn it off to go
            unlisted while keeping your profile link shareable.
          </span>
        </label>
      )}
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </div>
  );
}

/** Change your @handle. Availability is checked as you type. */
function UsernameSection() {
  const [handle, setHandle] = useState("");
  const [original, setOriginal] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "free" | "taken" | "invalid">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    import("@/lib/friends")
      .then((f) => f.fetchMyUsername())
      .then((me) => {
        setHandle(me.username ?? "");
        setOriginal(me.username ?? "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!handle || handle === original) return void setState("idle");
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) return void setState("invalid");
    setState("checking");
    const t = setTimeout(() => {
      import("@/lib/friends")
        .then((f) => f.isUsernameAvailable(handle))
        .then((free) => setState(free ? "free" : "taken"))
        .catch(() => setState("idle"));
    }, 350);
    return () => clearTimeout(t);
  }, [handle, original]);

  return (
    <div className="card mb-6 p-4">
      <h2 className="mb-1 font-semibold">Username</h2>
      <p className="mb-3 text-sm text-muted">How friends find you in search. 3–20 characters: letters, numbers, underscores.</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border bg-surface px-3">
          <span className="text-muted">@</span>
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            maxLength={20}
            className="w-44 bg-transparent py-2 text-sm outline-none"
          />
        </div>
        <button
          onClick={() => {
            setBusy(true);
            import("@/lib/friends")
              .then((f) => f.setUsername(handle))
              .then(() => {
                setOriginal(handle);
                setState("idle");
                setMsg("Saved.");
              })
              .catch((e) => setMsg(String(e.message ?? e)))
              .finally(() => setBusy(false));
          }}
          disabled={busy || state !== "free"}
          className="btn-primary"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <span className="text-xs">
          {state === "checking" && <span className="text-faint">checking…</span>}
          {state === "free" && <span className="text-ok">free ✓</span>}
          {state === "taken" && <span className="text-danger">taken</span>}
          {state === "invalid" && <span className="text-warn">3–20 chars, a–z 0–9 _</span>}
        </span>
      </div>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </div>
  );
}

function ProfileSection() {
  const [displayName, setDisplayName] = useState<string>("");
  const [birthDate, setBirthDate] = useState<string>("");
  const [country, setCountry] = useState<string>("");
  const [targetWeight, setTargetWeight] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchProfile()
      .then((p) => {
        setDisplayName(p.displayName ?? "");
        setBirthDate(p.birthDate ?? "");
        setCountry(p.country ?? "");
        setTargetWeight(p.targetWeightKg != null ? String(p.targetWeightKg) : "");
      })
      .catch(() => setMsg("Profile needs migrations 0002–0004 — run them in the Supabase SQL Editor."));
  }, []);

  return (
    <div className="card mb-6 p-4">
      <h2 className="mb-1 font-semibold">You</h2>
      <p className="mb-3 text-sm text-muted">Powers the &ldquo;life lived&rdquo; card on Home. Stays private like everything else.</p>
      <div className="flex flex-wrap gap-3">
        <label className="text-xs text-muted">
          Display name (shown to friends and in the Arena)
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className="mt-0.5 block w-44 rounded-lg border bg-surface px-2 py-2 text-sm text-ink"
          />
        </label>
        <label className="text-xs text-muted">
          Birthday
          <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="mt-0.5 block rounded-lg border bg-surface px-2 py-2 text-sm text-ink" />
        </label>
        <label className="text-xs text-muted">
          Country
          <select value={country} onChange={(e) => setCountry(e.target.value)} className="mt-0.5 block rounded-lg border bg-surface px-2 py-2 text-sm text-ink">
            <option value="">— pick —</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Target weight (kg)
          <input
            type="number"
            step="0.5"
            inputMode="decimal"
            value={targetWeight}
            onChange={(e) => setTargetWeight(e.target.value)}
            placeholder="e.g. 75"
            className="mt-0.5 block w-28 rounded-lg border bg-surface px-2 py-2 text-sm text-ink"
          />
        </label>
        <button
          onClick={() => {
            setSaving(true);
            setMsg(null);
            const tw = targetWeight.trim() === "" ? null : Number(targetWeight);
            updateProfile({ displayName: displayName.trim() || null, birthDate: birthDate || null, country: country || null, targetWeightKg: Number.isFinite(tw as number) ? tw : null })
              .then(() => setMsg("Saved."))
              .catch((e) => setMsg(String(e.message ?? e)))
              .finally(() => setSaving(false));
          }}
          disabled={saving}
          className="self-end rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast disabled:opacity-40"
        >
          Save
        </button>
      </div>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
      {birthDate && (() => {
        const life = lifeStats(birthDate, country || null);
        if (!life) return null;
        return (
          <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
            You are <b>{life.ageYears.toFixed(1)}</b> years old — <b>{life.percentLived.toFixed(1)}%</b> of a{" "}
            {life.expectancy.toFixed(1)}-year expected life{country ? ` in ${country}` : ""} — with{" "}
            <b>~{life.yearsLeft.toFixed(1)} years</b> (~{Math.round(life.weeksLeft).toLocaleString()} weeks) left on average.
          </p>
        );
      })()}
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<BucketSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchBucketSettings().then(setSettings);
  }, []);

  if (!settings) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Settings</h1>
        <button
          onClick={() => {
            import("@/lib/supabase/client").then(({ createClient }) =>
              createClient().auth.signOut().then(() => (location.href = "/signin"))
            );
          }}
          className="rounded-lg border px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
        >
          Sign out
        </button>
      </div>
      <ProfileSection />
      <UsernameSection />
      <ProfileVisibilitySection />
      <AppearanceSection />
      <NavigationSection />
      <LabelRenameSection />
      <h2 className="mb-1 font-semibold">Ranking buckets</h2>
      <p className="mb-3 text-sm text-muted">
        Which categories count as productive vs brainrot in the ranking, and what color each bucket gets.
        Compare (Phase 3) will use these buckets and totals only — friends never see your labels unless you share them.
      </p>
      <BucketColorRows />
      <div className="card">
        {CATEGORIES.map((c) => (
          <div key={c.code} className="flex items-center gap-2 border-b px-4 py-2.5 last:border-0">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: c.color }} />
            <span className="flex-1 text-sm font-medium">
              {c.code} {c.name}
            </span>
            <select
              value={settings[c.code]}
              onChange={(e) => setSettings({ ...settings, [c.code]: e.target.value as Bucket })}
              className="rounded-lg border px-2 py-1 text-sm"
            >
              {BUCKETS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <button
        onClick={() => {
          setSaving(true);
          setMsg(null);
          saveBucketSettings(settings)
            .then(() => setMsg("Saved."))
            .catch((e) => setMsg(String(e.message ?? e)))
            .finally(() => setSaving(false));
        }}
        disabled={saving}
        className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast disabled:opacity-40"
      >
        Save
      </button>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </div>
  );
}
