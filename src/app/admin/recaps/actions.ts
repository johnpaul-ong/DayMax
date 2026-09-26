"use server";

/**
 * Drafts end-of-challenge recaps with Claude. Runs under the admin's own
 * session, so RLS (is_daymax_admin on challenge_recaps, membership on the
 * standings functions) is the authorisation — no service-role key.
 *
 * PRIVACY (AGENTS.md rule 3): the prompt carries only what the challenge board
 * already shows members — display names, scores, days logged, bucket hours.
 * Never slot labels, notes, or anything from day_entries beyond bucket sums.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { RECAP_RULES } from "@/lib/recapPrompt";

const MODEL = "claude-sonnet-5";



type Row = Record<string, any>;

function fmt(v: number | null | undefined, unit: string): string {
  if (v == null) return "no score";
  const n = Math.round(v * 10) / 10;
  if (unit === "%") return `${n}%`;
  if (unit === "" || unit === "currency") return String(n);
  return `${n} ${unit}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

export interface GenerateResult {
  generated: number;
  skipped: number;
  failed: { name: string; error: string }[];
}

/**
 * Draft recaps for a finished challenge. With `onlyUserId`, (re)drafts that one
 * member even if a recap exists — a regenerated recap goes back to
 * pending_approval. Without it, drafts only members who have no recap yet.
 */
export async function generateRecaps(challengeId: string, onlyUserId?: string): Promise<GenerateResult> {
  const supabase = createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in first.");
  const { data: isAdmin } = await supabase.rpc("is_daymax_admin");
  if (!isAdmin) throw new Error("Admins only.");
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set on the server. Add it to .env.local (local) or the Vercel project env vars, then retry.");
  }

  const { data: ch, error: chErr } = await supabase
    .from("challenges")
    .select("id, name, description, starts_on, ends_on")
    .eq("id", challengeId)
    .single();
  if (chErr || !ch) throw new Error("Challenge not found.");

  // Freezes the result; refuses (in UTC) until the challenge is over.
  const { error: finErr } = await supabase.rpc("finalize_challenge", { c: challengeId });
  if (finErr) throw new Error(finErr.message);

  const [standingsRes, lifeRes, resultsRes, existingRes] = await Promise.all([
    supabase.rpc("challenge_standings", { c: challengeId }),
    supabase.rpc("challenge_life_summary", { c: challengeId }),
    supabase.from("challenge_results").select("user_id, rank, score").eq("challenge_id", challengeId),
    supabase.from("challenge_recaps").select("user_id").eq("challenge_id", challengeId),
  ]);
  if (standingsRes.error) {
    throw new Error(`${standingsRes.error.message} — recaps are drafted from the member view, so the admin generating them must be in the challenge.`);
  }
  if (lifeRes.error) throw new Error(lifeRes.error.message);
  if (resultsRes.error) throw new Error(resultsRes.error.message);
  if (existingRes.error) throw new Error(existingRes.error.message);

  const standings = (standingsRes.data ?? []) as Row[];
  const life = new Map(((lifeRes.data ?? []) as Row[]).map((r) => [r.user_id as string, r]));
  const frozen = new Map(((resultsRes.data ?? []) as Row[]).map((r) => [r.user_id as string, r]));
  const hasRecap = new Set(((existingRes.data ?? []) as Row[]).map((r) => r.user_id as string));

  const unit: string = standings[0]?.score_unit ?? "";
  const label: string = standings[0]?.score_label ?? "Score";
  const totalDays = daysBetween(ch.starts_on, ch.ends_on);

  // Frozen rank/score wins over live; live fills anyone missing from results.
  const board = standings
    .map((s) => {
      const f = frozen.get(s.user_id);
      return {
        userId: s.user_id as string,
        name: s.display_name as string,
        rank: f ? Number(f.rank) : null,
        score: f?.score != null ? Number(f.score) : s.score != null ? Number(s.score) : null,
        entries: Number(s.entries ?? 0),
      };
    })
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  board.forEach((b, i) => { if (b.rank == null) b.rank = i + 1; });

  const leaderboard = board
    .map((b) => `${b.rank}. ${b.name}: ${fmt(b.score, unit)} (${b.entries} of ${totalDays} days logged)`)
    .join("\n");

  const targets = board.filter((b) => (onlyUserId ? b.userId === onlyUserId : !hasRecap.has(b.userId)));
  const client = new Anthropic();

  const settled = await Promise.allSettled(
    targets.map(async (b) => {
      const l = life.get(b.userId);
      const lifeLines = l
        ? [
            `Productive hours: ${fmt(Number(l.productive_hours), "h")}`,
            `Brainrot hours: ${fmt(Number(l.brainrot_hours), "h")}`,
            `Sleep: ${fmt(Number(l.sleep_hours), "h")} total` +
              (Number(l.days_logged) > 0 ? `, ${fmt(Number(l.sleep_hours) / Number(l.days_logged), "h")} per logged day` : ""),
            `Focus (productive share of productive + brainrot): ${fmt(l.focus == null ? null : Number(l.focus), "%")}`,
          ]
        : [];
      // Steer the model's tone: no logs, a couple of logged days, or a real
      // showing. The RECAP_RULES prompt spells out what each of these should
      // read like; this line just tells it which one we're in.
      const participation =
        b.entries === 0
          ? "No logs at all — acknowledgement only."
          : b.entries <= 2 || b.score == null
            ? "Light participation — acknowledgement, not performance."
            : "Solid participation — playful and competitive is fine.";
      const prompt = [
        `Challenge: ${ch.name}`,
        ch.description ? `About it: ${ch.description}` : null,
        `Window: ${ch.starts_on} to ${ch.ends_on} (${totalDays} days). Ranking: ${label} wins.`,
        ``,
        `Final leaderboard (${board.length} members):`,
        leaderboard,
        ``,
        `Write the recap for: ${b.name}`,
        `Finished: ${b.rank} of ${board.length}`,
        `Score: ${fmt(b.score, unit)}`,
        `Days logged: ${b.entries} of ${totalDays}`,
        `Participation: ${participation}`,
        ...lifeLines,
      ]
        .filter((line) => line !== null)
        .join("\n");

      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: "medium" },
        system: RECAP_RULES,
        messages: [{ role: "user", content: prompt }],
      });
      if (msg.stop_reason === "refusal") throw new Error("The model declined to write this recap.");
      const body = msg.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("")
        .trim();
      if (!body) throw new Error("The model returned no text.");

      const now = new Date().toISOString();
      const { error } = await supabase.from("challenge_recaps").upsert({
        challenge_id: challengeId,
        user_id: b.userId,
        body: body.slice(0, 2000),
        status: "pending_approval",
        model: msg.model,
        generated_at: now,
        updated_at: now,
        approved_at: null,
        approved_by: null,
      });
      if (error) throw new Error(error.message);
    }),
  );

  const failed = settled.flatMap((s, i) =>
    s.status === "rejected"
      ? [{
          name: targets[i].name,
          error: s.reason instanceof Anthropic.AuthenticationError
            ? "ANTHROPIC_API_KEY was rejected by the API."
            : s.reason instanceof Anthropic.RateLimitError
              ? "Rate limited by the API. Try again in a minute."
              : String(s.reason?.message ?? s.reason),
        }]
      : [],
  );
  return { generated: targets.length - failed.length, skipped: board.length - targets.length, failed };
}
