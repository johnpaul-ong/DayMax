# Shipping a change

Stick this on a Post-it. Two systems, and they're independent: **Vercel serves
the code, Supabase holds the data.** A change to one doesn't touch the other,
which is why a deploy can look fine and still be broken (new code, old database)
or the reverse.

---

## The whole thing, every time

```bash
cd ~/Code/daymax
git push
```

That's it for code. Vercel watches the `main` branch and rebuilds automatically
— usually live in 60–90 seconds.

**If the change needs new database tables or functions**, also paste the
migration into the Supabase SQL editor. The migration comes *first* if it adds
something the new code reads; otherwise the new code will error until it lands.

---

## Order matters

| Change | Order |
|---|---|
| Code only (UI, copy, styling) | `git push` |
| New table or function the code uses | **SQL first**, then `git push` |
| Dropping something the old code used | `git push` first, then SQL |

When in doubt, SQL first. New database objects nobody reads yet are harmless;
code that reads objects that don't exist is not.

---

## Checking it worked

**Vercel** → your project → Deployments. The top entry should be green and its
`Commit:` line should match your latest. If it shows an older commit, you're
looking at a stale deploy — hit Redeploy on the right one.

```bash
git log --oneline -1     # what you just pushed
```

**Supabase** → SQL editor. Run the verify block at the bottom of whichever
`apply_*.sql` you used. Or the general one:

```sql
-- which DayMax tables exist in THIS database
\i supabase/seed/which_db_is_this.sql
```

---

## The mistake that cost you an hour

**Make sure you're in the right Supabase project.** If you have more than one,
the SQL editor doesn't shout about it and the error you get is a confusing
"relation does not exist".

Check: the project ref in the Supabase URL must match
`NEXT_PUBLIC_SUPABASE_URL` in Vercel → Settings → Environment Variables.

`supabase/seed/which_db_is_this.sql` prints both the database identity and a
true/false for every table, so you can see at a glance which project you're in
and how far its migrations got.

---

## If the deploy fails

Vercel shows the build log. The usual causes, in order of likelihood:

1. **TypeScript error.** Catch it before pushing: `npm run typecheck`
2. **Missing env var** — `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. **A failing test**, once CI is enforcing them.

Run the whole check locally in one go:

```bash
npm run typecheck && npm test && npm run build
```

If that passes, Vercel will too.

---

## Rolling back

Vercel → Deployments → find the last good one → **⋯ → Promote to Production**.
Instant, no rebuild. Then fix forward at your own pace.

Database changes don't roll back this way — every migration here is wrapped in a
transaction, so a failed one changes nothing, but a *successful* one you regret
needs a new migration to undo.

---

## Right now

You have **4 commits** waiting and one migration bundle outstanding:

```bash
cd ~/Code/daymax
git push
```

Then in the **correct** Supabase project, run
`supabase/apply_0033_to_0035.sql` (Web Push + Money + Challenges).
