# Getting DayMax onto an iPhone

Two stages, deliberately in this order: **prove people respond to a 15-minute
prompt before spending $99 and a week on a native app.**

---

## Why a PWA isn't enough on its own

Quick Capture (`src/app/capture-widget.tsx`) uses `new Notification()`, which
only fires **while the page is open**. Phone in your pocket, screen off:
nothing. On a laptop with the tab open it works exactly as designed; on mobile
it's decorative.

The constraint that shapes everything below:

| | PWA | Native (Capacitor) |
|---|---|---|
| Schedule a local notification | **No** | Yes, up to 64 pending |
| Receive a server push | Yes (iOS 16.4+, installed only) | Yes |
| Works offline | Only if pushed earlier | Yes |
| Cost to run | A server pinging every user | Free — the OS does it |

A PWA can't set its own alarm. Everything has to come from your server.

---

# Stage 1 — Web Push (now)

## 1. Keys

A VAPID keypair has been generated for you. The **public** key is safe to ship;
the **private** key must only ever live in Supabase secrets — never in git.

```
Vercel  → Settings → Environment Variables
  NEXT_PUBLIC_VAPID_PUBLIC_KEY = <public key>

Supabase → Edge Functions → Secrets   (or: supabase secrets set ...)
  VAPID_PUBLIC_KEY    = <public key>
  VAPID_PRIVATE_KEY   = <private key>
  VAPID_SUBJECT       = mailto:you@daymax.me
  PUSH_TRIGGER_SECRET = <any long random string>
```

Regenerate any time with:

```bash
npx web-push generate-vapid-keys
```

Changing them invalidates every existing subscription, so do it once.

## 2. Database

Run `supabase/migrations/0033_push_subscriptions.sql`.

The interesting part is `push_due()`. It does **not** return everyone — only
people who turned push on, are inside their own waking hours **in their own
timezone**, haven't been pushed within their minimum gap, and **have not
already logged the slot that just closed**.

That last condition is the whole design. Someone who logs as they go should
almost never hear from us. The prompt is for the slot you forgot.

## 3. Edge Function

```bash
supabase functions deploy capture-push --no-verify-jwt
```

`--no-verify-jwt` is required so pg_cron can call it; the `PUSH_TRIGGER_SECRET`
header is what actually protects it.

Test it by hand first:

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/capture-push \
  -H "x-trigger-secret: <PUSH_TRIGGER_SECRET>"
# -> {"due":0,"sent":0,"failed":0}   (0 due is correct if you've logged everything)
```

## 4. Schedule it

In the Supabase SQL editor. Runs every 15 minutes on the quarter-hour; each
person's own `push_min_gap_min` decides whether they actually get anything.

```sql
select cron.schedule(
  'daymax-capture-push',
  '0,15,30,45 * * * *',
  $$
  select net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/capture-push',
    headers := '{"Content-Type":"application/json","x-trigger-secret":"<PUSH_TRIGGER_SECRET>"}'::jsonb
  );
  $$
);
```

Check it: `select * from cron.job;` and `select * from cron.job_run_details order by start_time desc limit 10;`

To stop: `select cron.unschedule('daymax-capture-push');`

## 5. Turn it on, on your phone

**This is the bit people get stuck on.** iOS only allows push for an
*installed* PWA:

1. Open `https://daymax.me` in **Safari** (not Chrome — iOS Chrome can't do this).
2. **Share → Add to Home Screen.**
3. Open DayMax **from the home screen icon**, not the browser.
4. Settings → *Notifications on your phone* → tick **Send me prompts**.

The Settings panel detects when you're in a tab rather than the installed app
and says so, rather than showing a dead checkbox.

Android/Chrome needs none of this — the toggle just works.

## 6. What to watch

Give it a fortnight and look at:

- **Response rate** — do slots get filled within ~10 minutes of a push?
  If yes, build the native app. If people swipe them away, the problem isn't
  delivery, it's that a 15-minute prompt is too often. Try `push_min_gap_min`
  of 60 before concluding anything.
- **Unsubscribes** — `select count(*) from push_subscriptions;` over time.
- **Dead endpoints** — `failures` climbing means stale subscriptions; they're
  auto-pruned at 5.

---

# Stage 2 — Capacitor (only if stage 1 works)

Roughly a week. Wraps the **existing** app: no rewrite, same 11k lines.

```bash
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/local-notifications
npx cap init DayMax me.daymax.app --web-dir=out
npx cap add ios
```

Then:

1. **Static export** — `next.config.js` gets `output: "export"`, and anything
   using server-only Next features has to go. This app is entirely
   `"use client"` with Supabase called from the browser, so it should export
   cleanly, but `src/app/manifest.ts` will need to become a static file.
2. **Swap the notification layer.** In `capture-widget.tsx`, replace
   `new Notification(...)` with `LocalNotifications.schedule(...)`, queuing the
   next ~16 slot boundaries. This is the entire point of going native: the OS
   fires them, offline, with no server.
3. **Keep Web Push for desktop.** The two coexist; native uses local
   notifications, browsers keep using push.
4. Apple Developer account ($99/yr), icons come from `public/` already, and
   App Review will want a privacy policy URL and a working demo account.

**Don't start stage 2 until the numbers from stage 1 say people respond.**
It's a week of work to fix a problem you may not have.
