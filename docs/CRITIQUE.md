# DayMax — brutal critique

Audit of 10,900 lines of TypeScript, 30 migrations, 18 tables, 58 SQL functions.
Written to be useful, not kind.

---

## 1. Security: it is currently exploitable

An independent audit pass found **four holes that any signed-in user could walk
through**, and one that needs no account at all. Migration `0030` fixes them.
Do not put this in front of strangers until it's applied.

### The one that matters most

Three separate tables had an `UPDATE` policy that pinned *who owns a row* but
not *which parent it points at*. Postgres validates the new row against
`WITH CHECK`; if the foreign key isn't in there, the row can be re-parented —
which walks straight past the `INSERT` policy that was doing the real work.

| Table | Exploit | Grants |
|---|---|---|
| `track_members` | `PATCH` your own membership's `track_id` | Any private track: compare data, **raw 15-minute labels**, the board |
| `friendships` | Rewrite an incoming request's `requester` | Forged friendship with anyone → their friend-tier profile and mood data |
| `pursuit_members` | Re-point your auto-created Life membership | Any invite-only pursuit's member data |

One `PATCH` request each. No clever timing, no race.

### Worse, because it needs no account

`demo_copy_day()`, `demo_fill_to_today()` and `demo_intraday_tick()` are
`SECURITY DEFINER`, take a user id, check **nothing**, and were never `REVOKE`d.
PostgREST exposes them to `anon`. Anyone on the internet could insert rows into
any user's `day_entries` and `lift_entries`, unbounded, forever. They were dead
code from the pre-`0016` demo design. `0030` deletes them.

### The rest

- `duplicate_accounts()` returned **every email address on the platform** to any
  caller. That was my diagnostic function from the duplicate-account hunt, and I
  should never have shipped it as a DB function. Dropped.
- `pursuit_stat_top(s, n)` took a caller-controlled `n`. Every account is
  auto-joined to the public DayMax pursuit, so `n=100000` was a directory of
  every user's name and handle — precisely the thing `pursuit_member_list`
  deliberately refuses to emit. Clamped to 25.
- You could set your own `is_demo = true`. `is_connected()`, `can_view_profile()`
  and the label gate in `member_day_strip` all trust that flag. Self-promotion to
  "legend" was a `PATCH` away.
- `hidden` on a stat was a **client-side filter only**. The name, target and
  every member's values stayed readable through the table API.
- Signup errors echoed the stored email back to unauthenticated callers.

**Lesson worth internalising:** every one of these is the same shape — a rule
enforced in the browser, or in an `INSERT` path, but not on the `UPDATE` path.
RLS is not "on or off"; it's four independent doors per table.

---

## 2. Performance: the next wall is already visible

### Indexes that don't match the queries

Four hot lookups had no usable index, all for the same reason: the primary key's
**leading column** is different from the column actually filtered on.

| Table | PK | Filtered by | Was |
|---|---|---|---|
| `pursuit_entries` | `(user_id, stat_id, date)` | `stat_id` alone | **seq scan** |
| `track_members` | `(track_id, user_id)` | `user_id` alone | seq scan |
| `pursuit_members` | `(pursuit_id, user_id)` | `user_id` alone | seq scan |
| `friendships` | `unique(requester, addressee)` | `addressee` | seq scan |

`is_connected()` calls the last three **per row**, and it's called per row by
`pursuit_member_list` and `pursuit_day_totals`. That's a seq scan inside a loop
inside a loop. It's invisible at 9 users and fatal at 900. Fixed in `0030`.

### Storage is the real ceiling

96 slots × 365 days × one row each:

| Users | Rows/year | Size |
|---|---|---|
| 100 | 3.5M | 0.3 GB |
| 1,000 | 35M | 2.8 GB |
| 10,000 | 350M | 28 GB |

**~1,800 user-years fills Supabase's free tier on `day_entries` alone.** The Pro
tier's 8GB is gone at ~2,800 users. This is a design consequence, not a bug —
one row per 15 minutes is what makes the app what it is — but it means the
business model has to survive roughly **$0.125/user/year in storage** before
anything else. Compression options, in order of how much they'd hurt:

1. Archive years older than N into a `day_entries_archive` table with the
   96-char pattern string per day (the format the demo seed already uses).
   ~96× fewer rows, still queryable. **Do this one.**
2. Store the day as a single `char(96)` column and expand client-side. Same
   saving, applies to live data, but every existing query has to change.
3. Nothing, and pay. Viable to ~5,000 users.

### Client-side

Fixed this session: the community reads had a per-row `demo_row_visible()` call
that itself queried `profiles` twice (once via `viewer_local_ts()`), on ~200k
rows. That's what caused your statement timeout. Now: clock resolved once,
buckets by `CASE`, date windows, 60s cache.

Still outstanding: `src/app/pursuits/page.tsx:47` fans out `fetchStats` +
`fetchMyEntries` per pursuit. Fine at 8 pursuits, not at 50.

---

## 3. Product: the honest read

### What is genuinely good

- **The 15-minute grid is the moat.** Nobody else makes you account for a day at
  that resolution. It's the reason the data is interesting.
- **"Your life" in weeks** is the emotional hook, and putting it in onboarding
  is right.
- **Team = theme** is a genuinely elegant bit of design. Zero extra decisions,
  instant tribe, and it makes a cosmetic choice load-bearing.
- **WorkMax over focus score** was the right call. Ratio-only metrics reward not
  logging your bad hours.
- **Consent-first sharing** is unusually principled for a social app. Owner-added
  members join `hidden`. Labels never leave without explicit opt-in.

### What is honestly weak

**The core loop is brutal.** 96 slots a day is ~10 minutes of daily data entry.
The demo characters have perfect year-long records because a Python script wrote
them. No real user will. **The single biggest risk to this product is that the
logging burden exceeds the payoff**, and nothing in the app currently reduces it.
Missing, in order of impact:

1. **Fast entry.** "Same as yesterday", drag-to-fill a range, recent-label
   autocomplete, a template for a typical weekday. You have a copy-yesterday
   feature and *removed* it.
2. **Reminders.** No notifications, no email nudge, no streak. A tracker with no
   retention mechanic is a tracker people use for nine days.
3. **Retroactive entry that doesn't hurt.** Filling in Tuesday on Thursday is the
   normal case, not the exception.

**Two competing social models.** Tracks (invite, share-rules, boards, compare)
and Pursuits (join, stats, leaderboards, teams) do overlapping jobs with separate
schemas, separate functions and separate UI. Users have to learn both, and you
have to maintain both. **Pursuits are the better abstraction.** Tracks should
become a pursuit with a member list and a board.

**The Arena vs pursuit boards overlap** for the same reason.

**Empty-state problem is structural.** A new user sees leaderboards topped by
fictional characters with a year of perfect data. That's aspirational for about
one session and demoralising after. Consider showing the legends only in their
own pursuit, and making the first-week experience about *your* data.

**No mobile app, and the day grid is a desktop interaction.** A 96-row table with
hover tooltips is not a phone experience, and the phone is where logging happens.
41 `title=` tooltips are invisible on touch and to screen readers. One `aria-`
attribute in the whole codebase.

---

## 4. Developer side

### Good

Semantic Tailwind tokens with no hardcoded colours. All cross-user reads through
`SECURITY DEFINER` functions. Comments explain *why*, including the traps
(`AGENTS.md` names the 1000-row cap as "fixed TWICE, don't reintroduce"). Small
dependency list — 7 runtime deps.

### Bad

- **Zero tests.** `vitest` is installed and there is no test directory. For an
  app whose correctness lives in SQL predicates, this is the biggest process
  gap. The bugs this session — missing `pursuit_id` filter, UTC dates, flex
  overflow — are all things a test would have caught in seconds.
- **41 `.catch(() => {})`.** Failures are invisible. When the Judo pursuit
  didn't load there was no error anywhere, because every fetch swallows.
- **`pursuits/[id]/page.tsx` is 1,144 lines** with eight components in it.
- **30 migrations, several rewriting the same function 4–5 times.** Correct
  practice, but nobody can now tell what's live without reading all of them in
  order. Generate a `schema.sql` snapshot.
- **No CI.** No typecheck or build on push.

---

## 5. What to add, what to remove

### Add (ranked by value per unit of work)

1. **Fast day entry** — drag-to-fill, copy-yesterday, label autocomplete. Fixes
   the core loop. Highest value in the document.
2. **A test suite** — start with `lib/ranking.ts`, `lib/life.ts`, `lib/dates.ts`.
   Pure functions, trivial to test, currently zero coverage.
3. **Streaks and a weekly email** — the retention mechanic that doesn't exist.
4. **`schema.sql` snapshot + CI typecheck.**
5. **Insight generation** — "you're 40% more productive on days you train
   before 9am". You have the correlation engine in `/overview` already; surface
   it as prose. This is what people screenshot and share.
6. **Data export/delete in one click** — GDPR, and it builds trust.

### Remove

1. **Tracks**, folded into Pursuits. Two social models is one too many.
2. **The `habits` page** — superseded by Pursuits.
3. **`AddFriendCard` invite links** — friend requests do this now, as you said.
4. **Demo characters from general leaderboards** — done, keep going.
5. **The theme accent picker's full colour wheel** — eight presets is enough;
   arbitrary hex lets people make the UI unreadable.

---

## 6. Future-proofing

**Do now (cheap, expensive later):**
- `0030`. Non-negotiable before public launch.
- Schema snapshot; migration count is already unreadable.
- Tests on the pure functions.
- Pick Pursuits or Tracks. The cost of maintaining both compounds.

**Do at ~500 users:**
- Archive strategy for `day_entries`.
- Materialised views for leaderboards, refreshed every few minutes. Every board
  currently recomputes from raw slots on every load.
- Rate limiting. Nothing stops a script hammering the RPCs.

**Do at ~5,000 users:**
- Move aggregates to a warehouse or nightly rollup tables.
- Consider whether one-row-per-slot survives contact with reality.

**Architectural bets to be aware of:**
- **Supabase**: brilliant for speed here, but all business logic in plpgsql is
  hard to test and unversioned relative to the app. If you ever leave, the
  migration is the whole product.
- **Everything client-side**: the entire data layer is `"use client"`. No SSR, no
  caching, no edge. Every page load is a cold round trip to Postgres. The fix
  when it matters is server components for the read-only pages.
- **No offline support**: the one thing a 15-minute logger genuinely needs on a
  phone. Local-first with sync is a rewrite, so decide before you have users.

---

## 7. If I could change one thing

Not the security holes — those are patchable and now patched.

**The logging burden.** Everything else in this document is downstream of
whether a real person can sustain 96 slots a day. The demo universe is
seductive precisely because it's fictional: it shows what the app looks like
with perfect data, which is exactly the state no user will ever be in. Build
the fast-entry path before building another leaderboard.
