# DayMax

Private, invite-only web app for tracking your day in 15-minute slots and your lifting progress. Built for one person and their close friends — not a public social network.

**Version 1 tracks:** Day (15-minute grid with a productivity ranking) and Lifts. Custom track types (Tape/measurements, calories, …) come later — see `docs/ROADMAP.md`.

## Run locally

1. `npm install`
2. Create a free [Supabase](https://supabase.com) project.
3. In the Supabase dashboard, open **SQL Editor** and run the contents of `supabase/migrations/0001_init.sql`.
4. Copy `.env.local.example` to `.env.local` and fill in your project URL and anon key (Dashboard → Project Settings → API).
5. `npm run dev` → open http://localhost:3000, sign up with email + password.

Run tests with `npm test` (parsers and ranking logic — no database needed).

## What lives where

- `src/lib/` — pure logic: parsers for the source spreadsheet layouts, ranking math, Excel I/O. Fully unit-tested.
- `src/app/` — the pages: day grid, today (phone editor), lifts, overview, import, export, settings.
- `supabase/migrations/` — database schema. Every table has row-level security.
- `docs/` — product vision, architecture, data model, data contract for AI agents, roadmap.
- `fixtures/` — **sanitized** sample workbook for testing imports. Fake names, fake data.

## Non-negotiable rules

- **Real diary data never goes into git.** `.gitignore` blocks `*.xlsx` (except fixtures), `private/`, and all `.env` files.
- Secrets live in `.env.local` only.
- Compare features (Phase 3) use category totals only — raw labels are never shared by default.

See `AGENTS.md` if you are an AI agent picking this project up.
