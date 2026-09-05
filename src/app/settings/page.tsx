"use client";

/**
 * Settings: assign each parent category to a ranking bucket.
 * Defaults: productive = Work + Sports, brainrot = Other + Leisure.
 * (Share rules and invites arrive with Phase 3.)
 */

import { useEffect, useState } from "react";
import { CATEGORIES, type Bucket } from "@/lib/categories";
import { fetchBucketSettings, saveBucketSettings } from "@/lib/data";
import { applyTheme, loadTheme, saveTheme, THEMES, type ThemeName } from "@/lib/theme";
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
      <h1 className="mb-4 text-xl font-bold">Settings</h1>
      <AppearanceSection />
      <h2 className="mb-1 font-semibold">Ranking buckets</h2>
      <p className="mb-3 text-sm text-muted">
        Which categories count as productive vs brainrot in the ranking. Compare (Phase 3) will use these
        buckets and totals only — friends never see your labels unless you share them.
      </p>
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
