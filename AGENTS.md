# For AI agents working on DayMax

You are the workforce (product, engineering, security, docs). The user is the product owner. He is a consumer, not a developer — explain in plain language, tell him exactly which buttons to click, and **ask before expanding scope**.

## Ground rules

1. **Never commit private data.** The owner's real spreadsheet (`main_max_inches*.xlsx`) and any real diary exports stay out of git. `.gitignore` enforces this — do not weaken it. Sanitized fixtures live in `fixtures/`.
2. **Never put secrets in code.** Supabase keys live in `.env.local` (local) and Vercel env vars (deployed).
3. **Privacy is the product.** 15-minute labels are a diary. Any future Compare/friends feature shares category totals only, unless a user explicitly sets `raw_labels` per track. Default-deny.
4. **The day grid must beat Excel.** Fill-range, keyboard, copy-yesterday are core features, not extras. Any change that makes logging slower is a regression.
5. **Import never guesses.** Unparseable cells become warnings shown to the human, not silently coerced data.
6. **Minors** (Phase 3): under-18 accounts default to totals-only sharing; body-measurement tracks are opt-in with guardian acknowledgment.

## Where things are

| Thing | Location |
|---|---|
| Product vision | `docs/PRODUCT.md` |
| Architecture & auth | `docs/ARCHITECTURE.md` |
| Database tables & RLS | `docs/DATA_MODEL.md`, `supabase/migrations/` |
| JSON/CSV format other AIs produce | `docs/DATA_CONTRACT.md` |
| How the owner's real workbook maps to DayMax | `docs/IMPORT_MAX_INCHES.md` |
| Build phases & what's deliberately deferred | `docs/ROADMAP.md` |
| Copy-paste prompts for ChatGPT/Claude | `docs/PROMPTS.md` |

## Current state (update this when you change it)

- Phase 0 + 1 complete: auth (password + magic link), day grid (zoom levels, cell-label toggle), year heatmap view, today editor, lifts, importer with preview (xlsx / pasted grid / JSON incl. `day_metrics`), month export, home dashboard, overview with ranking, bucket settings. Single-user; RLS locks every table to `auth.uid()`.
- Theming: light / dark / ghibli via CSS variables in `globals.css`, semantic Tailwind tokens (`bg-surface`, `text-ink`, `text-muted`, `bg-accent`, …) in `tailwind.config.ts`, per-device persistence in `src/lib/theme.ts`. **Never hardcode colors in pages — use the tokens** or all three themes break.
- Known gotcha (fixed TWICE, don't reintroduce): Supabase returns max 1000 rows per query AND per RPC call. Any fetch that can exceed that must page with `.range()` — see `fetchDayEntries` in `src/lib/data.ts` and `rpcAll()` in `src/lib/friends.ts`. All set-returning RPCs must go through `rpcAll`.
- Also shipped: active-tab nav highlight ("/day" is labelled **Month**); year page day-by-day 96-slot strip with legend, days click through to /day?m=YYYY-MM; overview is section-configurable per device (ranking / hours / trends / correlations / lifts, localStorage `daymax-overview-sections`) with a build-your-own Trends chart (min-max normalized "relative" mode) and ONE combined lifts chart — per-exercise progression + bodyweight live on the Lifts page; goals support kg or reps (`lift_goals.unit`, migrations 0002 + 0003); focus score = productive/(productive+brainrot)×100 is the headline comparison stat; life-lived card with weeks-of-life grid (`src/lib/life.ts`); user-editable bucket colours (localStorage, `src/lib/theme.ts`).
- Demo universe (migration 0007 + `supabase/seed/demo_marvel.sql`, a GENERATED file — regenerate, don't hand-edit): 5 `is_demo` Avengers accounts with a themed 2026 (Bruce's Hulk days = emotional 0 + 50-tonne deadlifts), public demo track "Avengers Assemble", readable by every signed-in user via `is_track_member` (demo tracks count as membership for reads; writes still RLS-locked). `/arena` page = leaderboards via `leaderboard_day_totals()` (demo users + co-members, hidden excluded).
- Social v2 (migration 0012): `friendships` (request/accept), `search_profiles` (opt-in `profiles.discoverable`, minors and demo NEVER searchable — minors add people, not vice versa), `is_connected()` now gates profiles/metrics (track OR friendship), `add_track_member()` adds accepted friends to owned tracks with share_rule **hidden** (consent-first — members opt in to sharing themselves). Habits: `metric_types` registry + values in `daily_metrics`, personal-only UI at `/habits`; communities/Arena competition on custom metrics deliberately deferred. Home layout + hidden nav tabs are localStorage (`daymax-home-layout`, `daymax-hidden-tabs` via `NAV_TABS` in nav-links.tsx).
- Phase 2/3 SHIPPED (migration 0005): `tracks` / `track_members` / `invites` with RLS; Compare goes ONLY through security-definer SQL functions (`compare_day_totals`, `compare_lifts`, `compare_raw_day`, `track_member_list`) that enforce share rules — never query another user's tables from the client. Invite links `/join/<token>` (14-day expiry, optional email lock). Minors: `is_minor()` + guardian_ack enforced in SQL (join + raw_labels). UI: `/friends`, `/join/[token]`, label rename in Settings, signin honors `?next=`.
- Parsers in `src/lib/` are unit-tested (`npm test`) and were validated against the owner's real workbook.
