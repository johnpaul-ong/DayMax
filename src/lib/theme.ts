"use client";

/** Theme + accent persistence. Stored locally per device. */

export type ThemeName = "light" | "dark" | "ghibli";
export const THEMES: Array<{ name: ThemeName; label: string; icon: string }> = [
  { name: "light", label: "Light", icon: "☀️" },
  { name: "dark", label: "Dark", icon: "🌙" },
  { name: "ghibli", label: "Ghibli", icon: "🍃" },
];

export function applyTheme(theme: ThemeName, accent?: string | null) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  if (accent) {
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-hover", accent);
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-hover");
  }
}

export function loadTheme(): { theme: ThemeName; accent: string | null } {
  try {
    const theme = (localStorage.getItem("daymax-theme") as ThemeName) || "light";
    const accent = localStorage.getItem("daymax-accent");
    return { theme: ["light", "dark", "ghibli"].includes(theme) ? theme : "light", accent };
  } catch {
    return { theme: "light", accent: null };
  }
}

export function saveTheme(theme: ThemeName, accent: string | null) {
  try {
    localStorage.setItem("daymax-theme", theme);
    if (accent) localStorage.setItem("daymax-accent", accent);
    else localStorage.removeItem("daymax-accent");
  } catch {}
}

// --- ranking bucket colours (per device, used by charts and the year view) ----

export interface BucketColors {
  productive: string;
  brainrot: string;
  other: string;
}

export const DEFAULT_BUCKET_COLORS: BucketColors = {
  productive: "#16a34a",
  brainrot: "#dc2626",
  other: "#94a3b8",
};

export function loadBucketColors(): BucketColors {
  try {
    const raw = localStorage.getItem("daymax-bucket-colors");
    if (!raw) return { ...DEFAULT_BUCKET_COLORS };
    return { ...DEFAULT_BUCKET_COLORS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_BUCKET_COLORS };
  }
}

export function saveBucketColors(colors: BucketColors) {
  try {
    localStorage.setItem("daymax-bucket-colors", JSON.stringify(colors));
  } catch {}
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear blend between two hex colours; t=0 -> a, t=1 -> b. */
export function blendHex(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  const c = ra.map((v, i) => Math.round(v + (rb[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
