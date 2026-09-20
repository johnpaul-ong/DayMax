"use client";

/**
 * Theme picker + bucket colour rows for /settings.
 * Behaviour unchanged from the original inline versions; extracted to
 * shrink page.tsx.
 */

import { useEffect, useState } from "react";
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

export function AppearanceSection() {
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
      <h2 className="mb-1 font-semibold">Appearance &amp; team</h2>
      <p className="mb-3 text-sm text-muted">
        Your theme is also your team — Light, Midnight or Cottage. Every pursuit keeps score of them all, so
        switching theme switches sides. Follows your account across devices.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
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

export function BucketColorRows() {
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
