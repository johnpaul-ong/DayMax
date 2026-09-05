"use client";

import { createClient } from "@/lib/supabase/client";

export default function SignOutButton() {
  const supabase = createClient();
  return (
    <button
      onClick={async () => {
        await supabase.auth.signOut();
        location.href = "/signin";
      }}
      className="rounded-lg border px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
    >
      Sign out
    </button>
  );
}
