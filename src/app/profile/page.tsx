"use client";

// Your profile, as friends see it — living under the Profile tab where it belongs.
import { useEffect, useState } from "react";
import ProfileView from "../profile-view";
import { createClient } from "@/lib/supabase/client";

export default function MyProfilePage() {
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);
  if (!me) return <p className="text-sm text-muted">Opening your profile…</p>;
  return <ProfileView userId={me} />;
}
