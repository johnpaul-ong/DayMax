"use client";

// Invisible: applies the cached theme instantly, then syncs from the account.
// The visible theme picker lives in Settings -> Appearance.
import { useEffect } from "react";
import { applyTheme, loadTheme, syncThemeFromAccount } from "@/lib/theme";

export default function ThemeSync() {
  useEffect(() => {
    const { theme, accent } = loadTheme();
    applyTheme(theme, accent);
    void syncThemeFromAccount();
  }, []);
  return null;
}
