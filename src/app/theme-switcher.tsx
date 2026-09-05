"use client";

// Invisible: applies the cached theme instantly, then syncs from the account.
// Also parks the browser's timezone on the profile, so the server can reveal
// the demo universe on the viewer's clock rather than UTC.
// The visible theme picker lives in Settings -> Appearance.
import { useEffect } from "react";
import { browserTimezone } from "@/lib/dates";
import { createClient } from "@/lib/supabase/client";
import { applyTheme, loadTheme, syncThemeFromAccount } from "@/lib/theme";

export default function ThemeSync() {
  useEffect(() => {
    const { theme, accent } = loadTheme();
    applyTheme(theme, accent);
    void syncThemeFromAccount();

    // only write when it actually changed — this runs on every page load
    const tz = browserTimezone();
    if (!tz) return;
    if (localStorage.getItem("daymax-tz") === tz) return;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const { error } = await supabase.from("profiles").update({ timezone: tz }).eq("id", data.user.id);
      if (!error) {
        try {
          localStorage.setItem("daymax-tz", tz);
        } catch {}
      }
    })();
  }, []);
  return null;
}
