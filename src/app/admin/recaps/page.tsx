/**
 * Admin queue for end-of-challenge recaps. Same shape as
 * /admin/pursuit-requests: the server-side admin check is UX, RLS on
 * challenge_recaps is the security boundary.
 */

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Client from "./_client";

export const dynamic = "force-dynamic";
// The generate action makes one model call per member, in parallel.
export const maxDuration = 60;

export default async function AdminRecapsPage() {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return notFound();
  const { data: isAdmin } = await supabase.rpc("is_daymax_admin");
  if (!isAdmin) return notFound();
  return <Client />;
}
