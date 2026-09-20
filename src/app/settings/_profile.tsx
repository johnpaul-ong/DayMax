"use client";

/**
 * Profile-shaped settings: your name/birthday/country/target weight,
 * your @handle, your default lift, your currency, and the visibility grid
 * that decides who sees what on your public profile page.
 *
 * Extracted from page.tsx unchanged.
 */

import { useEffect, useState } from "react";
import { fetchProfile, updateProfile } from "@/lib/data";
import { friendlyBackendError } from "@/lib/friendlyError";
import { COUNTRIES, lifeStats } from "@/lib/life";
import {
  PROFILE_SECTIONS,
  type MyVisibility,
  type ProfileSection as ProfileSectionKey,
} from "@/lib/friends";
import { CURRENCIES, fetchCurrency, setCurrency } from "@/lib/money";

/** Little "Saving… / Saved ✓" chip in a section header. */
function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return null;
  if (state === "saving") return <span className="text-[10px] text-faint">saving…</span>;
  if (state === "saved") return <span className="text-[10px] font-semibold text-ok">saved ✓</span>;
  return <span className="text-[10px] font-semibold text-danger">error</span>;
}

export function ProfileSection() {
  const [displayName, setDisplayName] = useState<string>("");
  const [birthDate, setBirthDate] = useState<string>("");
  const [country, setCountry] = useState<string>("");
  const [targetWeight, setTargetWeight] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchProfile()
      .then((p) => {
        setDisplayName(p.displayName ?? "");
        setBirthDate(p.birthDate ?? "");
        setCountry(p.country ?? "");
        setTargetWeight(p.targetWeightKg != null ? String(p.targetWeightKg) : "");
      })
      .catch((e) => setMsg(friendlyBackendError(e, "Your profile")))
      .finally(() => setLoaded(true));
  }, []);

  // Auto-save on change with a 700ms debounce. Fires ONLY after the
  // initial load (so we don't save the empty values back over the
  // fetched ones during first paint). Save button gone -- the user
  // said "too many save buttons" and this is the busiest offender.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      setSaveState("saving");
      setMsg(null);
      const tw = targetWeight.trim() === "" ? null : Number(targetWeight);
      updateProfile({
        displayName: displayName.trim() || null,
        birthDate: birthDate || null,
        country: country || null,
        targetWeightKg: Number.isFinite(tw as number) ? tw : null,
      })
        .then(() => {
          setSaveState("saved");
          setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1600);
        })
        .catch((e) => { setSaveState("error"); setMsg(String(e.message ?? e)); });
    }, 700);
    return () => clearTimeout(t);
  }, [loaded, displayName, birthDate, country, targetWeight]);

  return (
    <div className="card mb-6 p-4">
      <div className="mb-1 flex items-baseline gap-2">
        <h2 className="font-semibold">You</h2>
        <SaveIndicator state={saveState} />
      </div>
      <p className="mb-3 text-sm text-muted">Powers the &ldquo;life lived&rdquo; card on Home. Stays private like everything else. Changes save as you make them.</p>
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
      </div>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
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

/** Change your @handle. Availability is checked as you type. */
export function UsernameSection() {
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

  // Debounced availability check — 250ms (down from 350) so it feels
  // snappier while typing.
  useEffect(() => {
    if (!handle || handle === original) return void setState("idle");
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) return void setState("invalid");
    setState("checking");
    const t = setTimeout(() => {
      import("@/lib/friends")
        .then((f) => f.isUsernameAvailable(handle))
        .then((free) => setState(free ? "free" : "taken"))
        .catch(() => setState("idle"));
    }, 250);
    return () => clearTimeout(t);
  }, [handle, original]);

  // Auto-save the moment the handle becomes "free". No Save button:
  // the name-check IS the save gate. If the check says "taken" or
  // "invalid" we just don't fire.
  useEffect(() => {
    if (state !== "free") return;
    setBusy(true);
    setMsg(null);
    import("@/lib/friends")
      .then((f) => f.setUsername(handle))
      .then(() => {
        setOriginal(handle);
        setState("idle");
        setMsg("Saved.");
        setTimeout(() => setMsg((m) => (m === "Saved." ? null : m)), 1600);
      })
      .catch((e) => setMsg(String(e.message ?? e)))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <div className="card mb-6 p-4">
      <h2 className="mb-1 font-semibold">Username</h2>
      <p className="mb-3 text-sm text-muted">How friends find you in search. 3–20 characters: letters, numbers, underscores. Saves as soon as the name is free.</p>
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
        <span className="text-xs">
          {busy && <span className="text-faint">saving…</span>}
          {!busy && state === "checking" && <span className="text-faint">checking…</span>}
          {!busy && state === "free" && <span className="text-ok">free ✓</span>}
          {!busy && state === "taken" && <span className="text-danger">taken</span>}
          {!busy && state === "invalid" && <span className="text-warn">3–20 chars, a–z 0–9 _</span>}
        </span>
      </div>
      {msg && <p className="mt-2 text-xs text-ok">{msg}</p>}
    </div>
  );
}

/** Which lift leads your profile. Falls back to your most-logged one. */
export function DefaultLiftSection() {
  const [exercises, setExercises] = useState<Array<{ exercise: string; sessions: number }>>([]);
  const [current, setCurrent] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    import("@/lib/supabase/client").then(async ({ createClient }) => {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const f = await import("@/lib/friends");
      f.fetchMemberExercises(auth.user.id).then(setExercises).catch(() => {});
      const { data } = await supabase.from("profiles").select("default_exercise").eq("id", auth.user.id).single();
      setCurrent(data?.default_exercise ?? "");
    });
  }, []);

  if (exercises.length === 0) return null;

  return (
    <div className="card mb-6 p-4">
      <h2 className="mb-1 font-semibold">Default lift</h2>
      <p className="mb-3 text-sm text-muted">
        The exercise your profile opens on. Bodyweight is shown on every profile as standard, so this is for the lift
        you actually care about.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={current}
          onChange={(e) => {
            const v = e.target.value;
            setCurrent(v);
            import("@/lib/friends")
              .then((f) => f.setDefaultExercise(v || null))
              .then(() => setMsg("Saved."))
              .catch((ex) => setMsg(String(ex.message ?? ex)));
          }}
          className="rounded-lg border bg-surface px-2 py-2 text-sm"
        >
          <option value="">Most-logged (automatic)</option>
          {exercises.map((x) => (
            <option key={x.exercise} value={x.exercise}>
              {x.exercise} ({x.sessions} session{x.sessions === 1 ? "" : "s"})
            </option>
          ))}
        </select>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>
    </div>
  );
}

/** Currency, used everywhere money is shown and to guard challenge rankings. */
export function CurrencySection() {
  const [cur, setCur] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    fetchCurrency().then(setCur).catch(() => {});
  }, []);
  if (!cur) return null;
  return (
    <div className="card mb-6 p-4">
      <h2 className="mb-1 font-semibold">Currency</h2>
      <p className="mb-3 text-sm text-muted">
        Used everywhere money appears. Challenges compare a share of income rather than raw amounts, so people on
        different currencies can still compete — but the numbers shown are yours.
      </p>
      <select
        value={cur}
        onChange={(e) => {
          setCur(e.target.value);
          setCurrency(e.target.value).then(() => setMsg("Saved.")).catch((x) => setMsg(String(x.message ?? x)));
        }}
        className="rounded-lg border bg-surface px-2 py-2 text-sm"
      >
        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      {msg && <span className="ml-2 text-sm text-muted">{msg}</span>}
    </div>
  );
}

/**
 * Two audiences, two lists: what anyone can see, and what friends can see.
 * Public is the default — going private hides the page from non-friends
 * entirely, which is why the public column greys out when it's off.
 */
export function ProfileVisibilitySection() {
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

  function toggle(which: "publicSections" | "friendSections", key: ProfileSectionKey) {
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
