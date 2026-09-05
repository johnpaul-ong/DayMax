"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SignInPage() {
  const supabase = createClient();
  const [mode, setMode] = useState<"password" | "magic" | "signup">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${location.origin}/auth/callback` },
        });
        setMsg(error ? error.message : "Check your email for the sign-in link. (Check spam too.)");
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        setMsg(error ? error.message : "Account created. Check your email to confirm, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setMsg(error.message);
        else {
          const next = new URLSearchParams(location.search).get("next");
          location.href = next && next.startsWith("/") ? next : "/";
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm card p-6">
      <h1 className="mb-1 text-2xl font-bold">
        Day<span className="text-accent">Max</span>
      </h1>
      <p className="mb-4 text-sm text-muted">Private. Invite-only. Your data stays yours.</p>

      <div className="mb-4 flex gap-1 rounded-lg bg-surface-2 p-1 text-sm">
        {(["password", "magic", "signup"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 rounded-lg px-2 py-1 ${mode === m ? "bg-surface font-semibold" : "text-muted"}`}
          >
            {m === "password" ? "Password" : m === "magic" ? "Magic link" : "Sign up"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-3">
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
        {mode !== "magic" && (
          <input
            type="password"
            required
            minLength={8}
            placeholder="Password (min 8 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />
        )}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? "…" : mode === "magic" ? "Send magic link" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>
      {msg && <p className="mt-3 text-sm text-muted">{msg}</p>}
    </div>
  );
}
