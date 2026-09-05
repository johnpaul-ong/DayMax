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
      className="rounded-md border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
    >
      Sign out
    </button>
  );
}
