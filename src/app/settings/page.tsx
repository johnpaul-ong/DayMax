"use client";

/**
 * Settings: assign each parent category to a ranking bucket.
 * Defaults: productive = Work + Sports, brainrot = Other + Leisure.
 * (Share rules and invites arrive with Phase 3.)
 */

import { useEffect, useState } from "react";
import { CATEGORIES, type Bucket } from "@/lib/categories";
import { fetchBucketSettings, saveBucketSettings } from "@/lib/data";
import type { BucketSettings } from "@/lib/types";

const BUCKETS: Bucket[] = ["productive", "brainrot", "other"];

export default function SettingsPage() {
  const [settings, setSettings] = useState<BucketSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchBucketSettings().then(setSettings);
  }, []);

  if (!settings) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-xl font-bold">Settings</h1>
      <p className="mb-4 text-sm text-slate-500">
        Which categories count as productive vs brainrot in the ranking. Compare (Phase 3) will use these
        buckets and totals only — friends never see your labels unless you share them.
      </p>
      <div className="rounded-xl border bg-white">
        {CATEGORIES.map((c) => (
          <div key={c.code} className="flex items-center gap-2 border-b px-4 py-2.5 last:border-0">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: c.color }} />
            <span className="flex-1 text-sm font-medium">
              {c.code} {c.name}
            </span>
            <select
              value={settings[c.code]}
              onChange={(e) => setSettings({ ...settings, [c.code]: e.target.value as Bucket })}
              className="rounded-md border px-2 py-1 text-sm"
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
        className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
      >
        Save
      </button>
      {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
    </div>
  );
}
