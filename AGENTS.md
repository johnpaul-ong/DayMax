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
- Known gotcha (fixed, don't reintroduce): Supabase returns max 1000 rows per query. Any fetch that can exceed that must page with `.range()` — see `fetchDayEntries`/`fetchAllDayEntries` in `src/lib/data.ts`.
- Also shipped: active-tab nav highlight; year page day-by-day 96-slot strip; overview period toggle (day/week/month), correlation explorer (Pearson r over day metrics vs bucket hours in `src/lib/stats.ts`), lift progression % + goals (table `lift_goals`, migration 0002), bodyweight trend; life-lived card (`src/lib/life.ts`, profile birth_date + country from migration 0002); user-editable bucket colours (localStorage, `src/lib/theme.ts`).
- Phase 2/3 (share rules, invites, Compare between friends) not started. Schema notes in `docs/ROADMAP.md`.
- Parsers in `src/lib/` are unit-tested (`npm test`) and were validated against the owner's real workbook.
