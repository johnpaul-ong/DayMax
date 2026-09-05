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
    // only ask once per browser; clearing it just means we ask again
    if (sessionStorage.getItem("daymax-welcomed") === "1") return;
    fetchMyUsername()
      .then((me) => {
        if (me.chosen) {
          sessionStorage.setItem("daymax-welcomed", "1");
        } else {
          router.replace("/welcome");
        }
      })
      .catch(() => {});
  }, [pathname, router]);

  return null;
}
