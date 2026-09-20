"use client";

/**
 * Data-management corner of /settings: the four "your data" tools that
 * used to be top-level nav (Import, Export, Metrics, Gaps), the
 * customisable-tabs picker, the label-rename tool, and the
 * account-delete danger zone.
 *
 * Extracted from page.tsx unchanged.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadHiddenTabs, NAV_TABS, saveHiddenTabs } from "../nav-links";

/** The way out. Typed confirmation, no undo, said plainly. */
export function DangerZone() {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="card mb-6 border-danger/40 p-4" style={{ borderWidth: 1 }}>
      <h2 className="mb-1 font-semibold text-danger">Delete account</h2>
      <p className="mb-3 text-sm text-muted">
        Permanently removes your account and everything in it: every logged slot, your lifts, metrics, pursuits,
        friendships and posts. This cannot be undone and there is no grace period. Pursuits you started that other
        people use are handed over rather than deleted.{" "}
        <b>Export your data first</b> if you want to keep it — Profile → Export.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Type DELETE"
          className="w-40 rounded-lg border bg-surface px-2 py-2 text-sm"
        />
        <button
          onClick={async () => {
            if (confirm !== "DELETE") return;
            if (!window.confirm("Last check: this permanently deletes your account and all your data. Continue?")) return;
            setBusy(true);
            setErr(null);
            try {
              const { createClient } = await import("@/lib/supabase/client");
              const supabase = createClient();
              const { error } = await supabase.rpc("delete_my_account", { confirm: "DELETE" });
              if (error) throw error;
              await supabase.auth.signOut();
              location.href = "/signin";
            } catch (e: any) {
              setErr(String(e.message ?? e));
              setBusy(false);
            }
          }}
          disabled={busy || confirm !== "DELETE"}
          className="rounded-xl border border-danger px-4 py-2 text-sm font-semibold text-danger disabled:opacity-40"
        >
          {busy ? "Deleting…" : "Delete my account"}
        </button>
      </div>
      {err && <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
    </div>
  );
}

/**
 * Import, Export and Metrics used to be three top-level nav items. Nobody
 * navigates to Import twice — they are tools you reach for occasionally, so
 * they live here instead of costing a third of the navigation.
 */
export function DataSection() {
  const links = [
    { href: "/gaps", label: "Missing time", hint: "Which days aren't finished, and a spreadsheet of just those days to fill in." },
    { href: "/metrics", label: "Day metrics", hint: "Emotion, tiredness, deep time, weight and notes — every day in one editable table." },
    { href: "/import", label: "Import", hint: "Bring in a spreadsheet of days, slots or lifts." },
    { href: "/export", label: "Export", hint: "Take everything with you as CSV." },
  ];
  return (
    <>
      <h2 className="mb-1 font-semibold">Your data</h2>
      <p className="mb-3 text-sm text-muted">Everything you have logged, in and out.</p>
      <div className="card mb-6 divide-y">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-2">
            <span className="flex-1">
              <span className="block text-sm font-medium">{l.label}</span>
              <span className="block text-xs text-muted">{l.hint}</span>
            </span>
            <span className="text-faint" aria-hidden="true">→</span>
          </Link>
        ))}
      </div>
    </>
  );
}

export function NavigationSection() {
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
        Don&apos;t compete? Hide Arena. Don&apos;t need the directory? Hide Search. DayMax is your app — show only
        what you use. Hiding a tab hides everything under it, so switching Arena off also hides Side by side.
        (Saved on this device. Today and Settings stay put — they&apos;re the way back to everything else.)
      </p>
      <div className="flex flex-wrap gap-2">
        {NAV_TABS.filter((t) => t.href !== "/settings" && t.href !== "/today").map((t) => (
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

export function LabelRenameSection() {
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
