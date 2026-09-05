# Roadmap

## ✅ Phase 0 — House
Repo, docs, Next.js + Supabase skeleton, gitignore that blocks real data.

## ✅ Phase 1 — You only
Auth (password + magic link), day grid (fill range / keyboard / copy yesterday), phone today-editor, lift logger, workbook/paste/JSON import with preview, month xlsx export, overview with productivity ranking, bucket settings.

**Success test: a full week logged in DayMax faster than in Excel. Do not start Phase 3 before this passes.**

## ✅ Phase 2 — Templates, not a builder
Tracks as first-class rows (`tracks`, migration 0005), label rename/merge tool in Settings, share rules per member per track (`hidden | totals_only | raw_labels`).

## ✅ Phase 3 — Friends
Invite by shareable link (no email infra; optional email restriction, 14-day expiry). Day Compare = leaderboard on focus score + productive/brainrot hours for today/week/all-time, plus a daily-score chart — totals only, **enforced in SQL security-definer functions** (`compare_day_totals`, `compare_lifts`, `compare_raw_day`), buckets from the track owner's settings. Lifts compare = per-exercise progression lines per member; notes never shared. Minors: `is_minor()` from profile birthday; guardian acknowledgment required to join and to enable raw_labels — enforced in the database, not just the UI.

## Phase 4 — DELAYED
Duplicate a track for a second friend group — only if invite-only groups prove insufficient.

## Phase 5 — Later
Custom track types (Tape/inches, calories — user-defined columns + units), Google login, production domain, nicer phone layout. Design constraint: custom types must not break Compare — comparisons only exist within a shared template.
