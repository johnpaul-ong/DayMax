/**
 * Admin queue for pursuit requests.
 *
 * Server-rendered outer shell so the admin check runs before ANY UI paints —
 * a non-admin gets a 404-like "not found" without even seeing the page
 * structure. RLS on `pursuit_requests` is the real security boundary; this
 * gate is UX (don't render the admin page for the wrong person) rather than
 * defence-in-depth.
 */

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Client from "./_client";

export const dynamic = "force-dynamic";

export default async function AdminPursuitRequestsPage() {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return notFound();
  // Use the same server RPC clients hit; keeps one source of truth for who
  // counts as an admin.
  const { data: isAdmin } = await supabase.rpc("is_daymax_admin");
  if (!isAdmin) return notFound();
  return <Client />;
}
