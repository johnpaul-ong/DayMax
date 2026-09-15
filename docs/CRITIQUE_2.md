# DayMax — second critique

14,675 lines of TypeScript · 35 migrations · 26 tables · 26 pages · 51 tests.

The first critique found security holes and a logging-burden problem. Those are
fixed. This one is about what's true now, through three lenses. Money and
Challenges are included in the assessment, not exempt from it.

---

## As a user

### "Too hard to use on a phone" — they're right, and here's precisely why

I measured it. **11 pages render an HTML `<table>`. 12 rely on
`overflow-x-auto`** — which is a polite way of saying "this doesn't fit, swipe
sideways". And the density is quantifiable: `friends/page.tsx` has **34**
instances of `py-1`, `py-0.5` or 9–10px text. Those are desktop dimensions. On a
phone they're targets you miss.

The worst offenders, in order:

| Page | Problem |
|---|---|
| `/day` | A 96-row × 31-column grid. Fundamentally not a phone artefact. |
| `/friends` | 34 sub-24px touch targets, nested expandable cards, three tables |
| `/pursuits/[id]` | 1,144 lines, 29 dense elements, five charts stacked |
| `/arena/compare` | Horizontal scroll *inside* vertical scroll — the worst pattern in mobile UI |

**Fixed this round:** a bottom tab bar (5 destinations, 56px tall, above the
44px minimum), and Money built phone-first with `inputMode="decimal"` so the
numeric keypad appears.

**Not fixed, and this is the honest part:** the other 25 pages are still
desktop-first. A bottom bar makes them *reachable*, not *usable*. The real work
is a pass over every table to become a card list below `sm:`, and that's a day
or two I haven't done.

**The `/day` grid deserves a specific decision.** It cannot be made good on a
phone — 2,976 cells will never work at 390px. The options are: hide it on
mobile and point at `/today`; replace it with a week view; or accept it as
desktop-only. Pretending is the one option that isn't available.

### Money is the best-designed thing in the app

Not flattery — a consequence of building it after learning the lesson. It has
what the rest lacks: **a fast path that requires two taps**. Amount → category →
saved. The item memory means "coffee" fills in its own category and last price.
The basket means a shop is one save.

It is also the only page where the primary action is the first thing you see.

### The empty-state problem persists

A new user still lands on leaderboards topped by fictional characters with a
year of perfect data. Money makes this worse, not better: an empty spending page
with no income set can't show you anything, and the challenge will rank you
`null` until you add income. **Nobody will guess that income is the unlock.**
That needs a first-run state that says so.

---

## As an engineer

### What's genuinely solid

- Every cross-user read goes through a `SECURITY DEFINER` function. After
  migration 0030 the RLS is tight, including on the `UPDATE` path, which is
  where it was broken.
- 51 tests on the pure logic, CI running typecheck + test + build.
- The new money schema is **correctly normalised**: entries are rows, not a
  packed stat, so slicing is a `group by` rather than a client-side reduce.
- `challenge_standings` computes live and `challenge_results` freezes — so a
  result can't drift if someone edits old spending after the fact. That's the
  right call and it's easy to get wrong.

### What I'd flag in review

**1. `challenge_standings` is O(members × entries) with no window.** It joins
every member's entire `spend_entries` filtered by the challenge window, per
call, uncached. At 10 members × 30 days it's nothing. At 500 members it's the
leaderboard problem from migration 0019 all over again, and I've already made
that mistake once in this codebase. It needs a materialised daily rollup before
it has real users.

**2. Two social models are now three.** Tracks, Pursuits, and Challenges.
Challenges at least have a genuine reason to be separate (they end). Tracks
still don't — they do what Pursuits do, with a second schema and second UI.
**Deleting Tracks is still the highest-value refactor available.**

**3. Money duplicates the categories concept.** `spend_categories` and
`categories.ts` (the day buckets) are both "a taxonomy with an
essential/productive flag the user can override". They're different enough to
justify, but if a third one appears, extract it.

**4. Currency is hardcoded to `$`.** `money()` takes a currency param and
nothing passes one. Fine for a personal app, a bug the moment someone in Europe
uses it — and challenge rankings would silently compare dollars to euros.

**5. `spend_entries` has no `updated_at`,** so there's no way to detect
retroactive edits — which matters when a challenge result depends on the data
not changing.

**6. Still 41 `.catch(() => {})`.** The money page adds more. When something
fails the user sees nothing, which is why the Judo pursuit bug took three rounds
to find.

### The scaling number, updated

`day_entries` was the ceiling: ~1,800 user-years fills Supabase's free tier.
`spend_entries` is negligible by comparison (~50 rows/user/month vs 35,000). So
Money costs almost nothing to store — it's the highest value-per-byte feature
in the app by two orders of magnitude.

That's worth sitting with. **The 15-minute day grid is the identity of DayMax
and also its biggest cost and its biggest retention risk. Money is cheap,
easy to log, and immediately useful.**

---

## As a business person

### The challenge feature is the first real growth mechanic

Everything before it was single-player with a leaderboard. A challenge has the
three properties that actually spread a product:

1. **A reason to invite** — a competition needs opponents. The invite link works
   for people who aren't in the pursuit, which is the correct decision.
2. **A deadline** — urgency without manufactured scarcity.
3. **An artefact** — the frozen result is a thing to argue about afterwards.

This is the most commercially interesting thing built so far. I'd go further:
**the challenge should be shareable to non-users**, landing on a public page
showing the standings with names blurred and a "join" button. Right now the link
only works for someone who already has an account.

### The positioning problem

DayMax is now: a time tracker, a lift log, a habit tracker, a social network,
and a budgeting app. That is **five products**, and the honest question is which
one a stranger would describe to a friend.

- "It's a time tracker" — competing with RescueTime, Toggl. Crowded.
- "It's a budgeting app" — competing with YNAB, Frollo. Very crowded, and they
  have bank feeds you don't.
- **"It's where my friends and I compete on how we spend our time and money"** —
  that's not crowded. That's the thing.

The competitive social layer is the product. Time and money are two inputs to
it. Framing it that way would sharpen every decision, including which of the
five to cut.

### What would make money

Not the app — the *challenges*. A free tier with public challenges, and paid
for: private group challenges with more than N people, custom metrics,
sponsored/branded challenges (a gym running a 30-day challenge for its members).
That's a real B2B2C wedge and it's adjacent to what you already have.

Charging for the tracker itself is hard — the data-entry burden means churn is
high and people don't renew things they feel guilty about.

### The risk nobody mentions

**You are asking people to log their spending by hand in 2026.** Every serious
budgeting app has bank feeds. Manual entry is a deliberate choice — it makes you
*notice*, which is the whole point — but it is also the reason most people will
stop. The 30-day challenge is the perfect test of whether the competition is
enough to sustain it. Watch the entry count in week 3, not week 1.

---

## The shortlist

**Do next:**
1. **Mobile pass on the top 5 pages** — tables to card lists below `sm:`.
   Decide what `/day` does on a phone.
2. **First-run state for Money** — "add your income to be ranked" is currently
   invisible and it gates the entire challenge.
3. **Currency** — a profile setting, used by `money()` and blocked in
   mixed-currency challenges.

**Do before real users:**
4. Rollup table for `challenge_standings`.
5. Public challenge landing page for non-users.
6. Stop swallowing errors.

**Do eventually:**
7. Fold Tracks into Pursuits.
8. Pick one of the five products to lead with.
