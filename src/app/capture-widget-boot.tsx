"use client";

/**
 * Lazy boot for the CaptureWidget.
 *
 * The widget is a 500+ line client component with useEffects and
 * imports that pulled the whole file into the root layout bundle --
 * shipped on /signin, /welcome, /auth even though it renders nothing
 * there. This shim keeps the module OFF the initial bundle for those
 * routes: we only next/dynamic import it once the pathname is a real
 * app route AND the user is signed in.
 *
 * ssr: false because the widget touches localStorage, Notification,
 * and Supabase client — all browser-only.
 */

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const CaptureWidget = dynamic(() => import("./capture-widget"), { ssr: false });

const OFFLIMITS = ["/signin", "/welcome", "/auth", "/join"];

export default function CaptureWidgetBoot() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSignedIn(!!s?.user));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!pathname) return null;
  if (OFFLIMITS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;
  if (!signedIn) return null;

  return <CaptureWidget />;
}
