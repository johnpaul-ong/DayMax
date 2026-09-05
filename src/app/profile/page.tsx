"use client";

// Your profile = exactly what a connected friend sees, plus your own tools.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ProfileRedirect() {
  const router = useRouter();
  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (data.user) router.replace(`/friends/${data.user.id}`);
        else router.replace("/signin");
      });
  }, [router]);
  return <p className="text-sm text-muted">Opening your profile…</p>;
}
