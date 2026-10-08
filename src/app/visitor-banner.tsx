"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Thin top-of-page strip shown only when the signed-in user is the
// shared demo account (email matches NEXT_PUBLIC_DEMO_EMAIL). Reminds
// visitors they're in a shared sandbox and offers the sign-up jump.
export default function VisitorBanner() {
  const demoEmail = process.env.NEXT_PUBLIC_DEMO_EMAIL;
  const [isVisitor, setIsVisitor] = useState(false);

  useEffect(() => {
    if (!demoEmail) return;
    createClient().auth.getUser().then(({ data }) => {
      const email = data.user?.email?.toLowerCase();
      if (email && email === demoEmail.toLowerCase()) setIsVisitor(true);
    });
  }, [demoEmail]);

  if (!isVisitor) return null;
  return (
    <div className="border-b bg-amber-100/70 px-4 py-1.5 text-center text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
      You&apos;re exploring DayMax as a visitor — shared sandbox, anything you
      log here is visible to other visitors.{" "}
      <a href="/signin" className="font-semibold underline">
        Make your own account
      </a>
    </div>
  );
}
