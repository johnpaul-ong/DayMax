import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Signs the request into the shared demo account and lands on the owner's
// profile so a first-time visitor sees something real, not an empty home.
// Credentials live server-side (DEMO_EMAIL / DEMO_PASSWORD) so they never
// ship in the client bundle; the button on /signin is gated by
// NEXT_PUBLIC_VISITOR_ENABLED so dev doesn't dangle a dead action when the
// account isn't configured. See README (Demo visitor) for the one-time
// Supabase + env setup.
export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  const email = process.env.DEMO_EMAIL;
  const password = process.env.DEMO_PASSWORD;

  if (!email || !password) {
    return NextResponse.redirect(
      `${origin}/signin?visitor_error=unconfigured`,
      { status: 303 }
    );
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.redirect(
      `${origin}/signin?visitor_error=${encodeURIComponent(error.message)}`,
      { status: 303 }
    );
  }

  // Snapshot approach (migrations 0050 + 0051): demo literally owns a copy
  // of the owner's day/metrics/lifts data, so every auth.uid()-filtered
  // query returns the snapshot. Writes are blocked at RLS level via
  // restrictive policies, so the visitor can click around but cannot
  // modify anything. Keep the lightweight profile+challenges sync on each
  // click so identity and membership stay fresh if the owner updates them.
  await supabase.rpc("daymax_sync_demo_from_owner");

  return NextResponse.redirect(`${origin}/profile`, { status: 303 });
}
