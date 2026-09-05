# Roadmap

## ✅ Phase 0 — House
Repo, docs, Next.js + Supabase skeleton, gitignore that blocks real data.

## ✅ Phase 1 — You only
Auth (password + magic link), day grid (fill range / keyboard / copy yesterday), phone today-editor, lift logger, workbook/paste/JSON import with preview, month xlsx export, overview with productivity ranking, bucket settings.

**Success test: a full week logged in DayMax faster than in Excel. Do not start Phase 3 before this passes.**

## Phase 2 — Templates, not a builder
- Track instances (Day, Lifts) as first-class rows (`tracks` table) instead of implicit per-user data.
- Personal subcategory management UI (rename labels, merge).
- Share rules per member per track: `hidden | totals_only | raw_labels` (owner default: Work + Sports raw for the owner).
- Bulk-fill improvements based on real usage pain.

## Phase 3 — Friends
- Invite by email/link. Invite-only, no public profiles.
- Day Compare = ranking (productive/brainrot/other + ratio) for day/week/all-time across track members. Totals only, enforced in SQL via `track_members.share_rule` — never client-side filtering.
- Lifts compare = lift progression graphs.
- **Minors:** age collected at signup; under-18 requires guardian acknowledgment; defaults to totals_only; body-measurement tracks opt-in with guardian agreement; no public anything.

## Phase 4 — DELAYED
Duplicate a track for a second friend group — only if invite-only groups prove insufficient.

## Phase 5 — Later
Custom track types (Tape/inches, calories — user-defined columns + units), Google login, production domain, nicer phone layout. Design constraint: custom types must not break Compare — comparisons only exist within a shared template.
