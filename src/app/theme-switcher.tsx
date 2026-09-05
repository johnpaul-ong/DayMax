"use client";

import { useEffect, useState } from "react";
import { applyTheme, loadTheme, saveTheme, saveThemeToAccount, syncThemeFromAccount, THEMES, type ThemeName } from "@/lib/theme";

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeName>("light");

  useEffect(() => {
    const { theme, accent } = loadTheme();
    setTheme(theme);
    applyTheme(theme, accent);
    // then pull the account's saved theme (new device / fresh browser)
    void syncThemeFromAccount().then(() => setTheme(loadTheme().theme));
  }, []);

  function cycle() {
    const idx = THEMES.findIndex((t) => t.name === theme);
    const next = THEMES[(idx + 1) % THEMES.length].name;
    setTheme(next);
    const { accent } = loadTheme();
    applyTheme(next, accent);
    saveTheme(next, accent);
    void saveThemeToAccount(next, accent);
  }

  const current = THEMES.find((t) => t.name === theme)!;
  return (
    <button
      onClick={cycle}
      title={`Theme: ${current.label} — click to switch`}
      className="ml-auto rounded-xl border bg-surface px-2.5 py-1.5 text-sm transition hover:bg-surface-2"
    >
      {current.icon}
    </button>
  );
}
