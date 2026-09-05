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
