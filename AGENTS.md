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

- Phase 0 + 1 complete: auth (password + magic link), day grid, today editor, lifts, importer with preview, month export, overview with ranking, bucket settings. Single-user; RLS locks every table to `auth.uid()`.
- Phase 2/3 (share rules, invites, Compare between friends) not started. Schema notes in `docs/ROADMAP.md`.
- Parsers in `src/lib/` are unit-tested (`npm test`) and were validated against the owner's real workbook.
