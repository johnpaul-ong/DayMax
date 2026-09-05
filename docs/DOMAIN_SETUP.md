# Putting DayMax on daymax.me

Do these in order. Steps 2 and 3 are the ones that break signups if skipped —
auth fails whenever the URL a person is actually on doesn't match what Supabase
has been told to expect.

## 1. Point the domain at Vercel

In **Vercel → your project → Settings → Domains → Add**, enter `daymax.me`.
Vercel will ask you to add records at your registrar. Add **both** the apex and
the `www` subdomain, and let Vercel redirect one to the other (pick `daymax.me`
as primary — shorter, and it's what you bought).

Typical records, but **use whatever values Vercel shows you**, not these:

| Type  | Name | Value                  |
|-------|------|------------------------|
| A     | `@`  | `76.76.21.21`          |
| CNAME | `www`| `cname.vercel-dns.com` |

DNS takes anywhere from a minute to a few hours. Vercel's Domains page shows a
green tick and issues the TLS certificate automatically once it resolves. Don't
move on until that tick appears.

## 2. Tell Supabase about the new URL — this is the one that matters

**Supabase → Authentication → URL Configuration:**

- **Site URL:** `https://daymax.me`
- **Redirect URLs** — these three, and delete the old `vercel.app` entries:
  - `https://daymax.me/**`
  - `https://www.daymax.me/**`
  - `http://localhost:3000/**` *(local development)*

The `/**` wildcard matters — without it only the exact root path is allowed and
`/auth/callback` is rejected.

**This is almost certainly why signups were failing.** When Site URL doesn't
match where someone actually signed up, the confirmation link points somewhere
invalid, the callback is refused, and no usable account is created — which is
why a person who swears they signed up doesn't appear in Authentication → Users.

## 3. Check the email templates

**Supabase → Authentication → Email Templates.** The default templates use
`{{ .ConfirmationURL }}`, which follows Site URL and needs no editing. If any
template has a hardcoded `vercel.app` link, replace it with
`{{ .ConfirmationURL }}`.

While you're here: the default confirmation link expires in 24 hours
(Authentication → Providers → Email). Worth raising if you're inviting people
who might not check email daily.

## 4. Environment variables

Nothing to change — `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` point at Supabase, not at your domain. The app
derives its own origin from `location.origin` at runtime, so invite links,
confirmation redirects and password resets all follow the new domain
automatically once DNS is live.

## 5. Verify, in this order

1. `https://daymax.me` loads and shows the sign-in page.
2. Sign up with an address you haven't used. The confirmation email arrives and
   its link points at `daymax.me`.
3. Clicking it lands you signed in, and the account appears in
   **Authentication → Users**.
4. Friends → a track → "Invite someone who's not on DayMax yet" produces a
   `https://daymax.me/join/...` link.
5. Settings → Sign out → sign back in.

## 6. Retry your friend

Once step 5 passes, have her sign up again at `https://daymax.me`. If her
earlier attempt did create a hidden record, the "already registered" path now
tells her to reset her password instead of silently doing nothing.

If it still fails, **Supabase → Logs → Auth Logs**, filtered to around the time
she tried, will name the actual error — usually a redirect URL that isn't on the
allow-list.

## Troubleshooting

**Vercel says "Invalid Configuration" on the domain.** DNS hasn't propagated, or
a record is wrong. Check at your registrar that the A record for `@` matches
what Vercel shows. `dig daymax.me` (or whatsmydns.net) tells you what the world
currently sees.

**Domain loads but shows someone else's page / a parking page.** The registrar
is still serving its default nameservers or a forwarding rule. Turn off any
"domain forwarding" or "parking" feature at the registrar.

**Site loads but signing in throws `requested path is invalid`.** Step 2 isn't
done, or the `/**` on the end of the redirect URL is missing.

**Certificate warning.** Vercel issues the cert after DNS resolves; it can take
a few minutes. If it's stuck over an hour, remove the domain in Vercel and
re-add it.

## Afterwards

Update `README.md` to say `daymax.me`. Vercel keeps serving the old
`daymax-azure.vercel.app` URL as well — that's automatic and harmless, and since
nobody uses it you can ignore it. Don't delete the Vercel project URL itself;
it's how Vercel routes deployments internally.
