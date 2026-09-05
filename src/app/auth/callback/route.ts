import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles the magic-link redirect: exchanges the code for a session.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(`${origin}/`);
}
