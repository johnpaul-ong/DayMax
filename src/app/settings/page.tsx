"use client";

/**
 * Settings: an assembly page. Each section lives in its own file
 * next to this one — the module used to be 1000+ lines because
 * every section grew comments and edge cases in place; the split
 * kept the code identical but made this file scannable again.
 */

import { useEffect, useState } from "react";
import { CATEGORIES, type Bucket } from "@/lib/categories";
import { fetchBucketSettings, saveBucketSettings } from "@/lib/data";
import type { BucketSettings } from "@/lib/types";

import { AppearanceSection, BucketColorRows } from "./_appearance";
import { CaptureSection, PushSection } from "./_capture-push";
import {
  CurrencySection,
  DefaultLiftSection,
  ProfileSection,
  ProfileVisibilitySection,
  UsernameSection,
} from "./_profile";
import { DangerZone, DataSection, LabelRenameSection, NavigationSection } from "./_data-nav";

const BUCKETS: Bucket[] = ["productive", "brainrot", "other"];

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
      <DefaultLiftSection />
      <CurrencySection />
      <ProfileVisibilitySection />
      <CaptureSection />
      <PushSection />
      <AppearanceSection />
      <NavigationSection />
      <DataSection />
      <LabelRenameSection />
      <h2 className="mb-1 font-semibold">Ranking buckets</h2>
      <p className="mb-3 text-sm text-muted">
        Which categories count as productive vs brainrot in the ranking, and what color each bucket gets.
        These pick which categories count toward each ranking bucket. Friends never see your labels unless you share them.
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
      <DangerZone />
    </div>
  );
}
