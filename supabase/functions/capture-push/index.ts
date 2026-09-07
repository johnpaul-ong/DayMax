/**
 * capture-push — sends the Quick Capture prompt.
 *
 * Invoked on a schedule (pg_cron -> pg_net -> here). It asks the database who
 * is actually due a prompt, which is a much smaller set than "everyone": see
 * push_due() in migration 0033. If nobody is due, this costs one query and
 * exits.
 *
 * Deploy:  supabase functions deploy capture-push --no-verify-jwt
 * Secrets: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@daymax.me
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@daymax.me";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

interface DueRow {
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  slot_label: string;
  missed: number;
}

Deno.serve(async (req) => {
  // A shared secret, because this is deployed with --no-verify-jwt so pg_cron
  // can reach it. Without this anyone could trigger a send.
  const secret = Deno.env.get("PUSH_TRIGGER_SECRET");
  if (secret && req.headers.get("x-trigger-secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await supabase.rpc("push_due");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const rows = (data ?? []) as DueRow[];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    rows.map(async (r) => {
      // Wording follows the size of the hole: one forgotten slot is a nudge,
      // eight is a different (and more useful) message.
      const body =
        r.missed > 3
          ? `${r.missed} slots unlogged — clear them in a few taps.`
          : `What were you doing at ${r.slot_label}?`;

      try {
        await webpush.sendNotification(
          { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          JSON.stringify({ title: "DayMax", body, url: "/today", tag: "daymax-capture" }),
          { TTL: 600 } // if it can't be delivered within 10 min it's stale anyway
        );
        sent++;
        await supabase.rpc("push_mark", { sub: r.subscription_id, ok: true });
      } catch (e) {
        failed++;
        // 404/410 mean the subscription is dead; push_mark prunes after 5
        await supabase.rpc("push_mark", { sub: r.subscription_id, ok: false });
        console.error("push failed", (e as Error).message);
      }
    })
  );

  return new Response(JSON.stringify({ due: rows.length, sent, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
