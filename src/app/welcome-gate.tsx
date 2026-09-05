"use client";

/**
 * Invisible: sends signed-in accounts that have never picked a handle to
 * /welcome, once. Deliberately fails open — if the check errors (not signed in,
 * migration 0021 not run yet), nobody gets trapped behind it.
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchMyUsername } from "@/lib/friends";

// pages that must stay reachable without a handle
const EXEMPT = ["/welcome", "/signin", "/auth", "/join"];

export default function WelcomeGate() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (EXEMPT.some((p) => pathname === p || pathname.startsWith(p + "/"))) return;
    // Ask once, ever. localStorage (not sessionStorage) so a new tab or a
    // restarted browser doesn't re-prompt someone who already picked a handle.
    try {
      if (localStorage.getItem("daymax-welcomed") === "1") return;
    } catch {
      return; // storage blocked — better to never nag than to nag forever
    }
    fetchMyUsername()
      .then((me) => {
        if (me.chosen) {
          try {
            localStorage.setItem("daymax-welcomed", "1");
          } catch {}
        } else {
          router.replace("/welcome");
        }
      })
      .catch(() => {});
  }, [pathname, router]);

  return null;
}
