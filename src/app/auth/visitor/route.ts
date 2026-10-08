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

  // RLS policies (migration 0049) let the demo user SELECT the owner's rows
  // on day/pursuit/lift tables, so / (overview, today, year strip, pursuits,
  // lifts) renders the owner's live data under the demo session. No per-page
  // handoff needed — standard app chrome shows "your" data because RLS gave
  // demo access to it.
  return NextResponse.redirect(`${origin}/`, { status: 303 });
}
