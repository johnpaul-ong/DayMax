# Data model

All tables in `supabase/migrations/0001_init.sql`. RLS: every row is owned by `user_id = auth.uid()`.

| Table | Grain | Notes |
|---|---|---|
| `profiles` | one per user | auto-created on signup by trigger |
| `day_entries` | user × date × slot (0–95) | `category` 0–9, `label` free text. PK enforces one value per slot. |
| `day_metrics` | user × date | emotional_score, tired, start_friction, end_brain_fatigue, deep_time, weight_kg, notes |
| `lift_entries` | one exercise on one date | `reps` is **text** on purpose ("AMRAP", "2 + 10") |
| `daily_metrics` | user × date × metric name | bodyweight_kg, run_time_min, tuna_rice, … open-ended |
| `bucket_settings` | user × category | overrides default productive/brainrot/other assignment |

## Conventions

- Dates are `date` (no timezones on purpose — a "day" is whatever the user's day was).
- Slot `n` = time `n*15` minutes after midnight. 96 slots/day. 4 slots = 1 hour.
- Category hour totals are always **recomputed from slots**, never trusted from imports.

## Phase 3 additions (not yet created)

- `tracks` (id, owner, kind: day|lifts, name)
- `track_members` (track, user, role, share_rule: hidden|totals_only|raw_labels, guardian_ack boolean)
- `invites` (track, email, token, expires)
- Compare endpoints must join through `track_members.share_rule` **in SQL/RLS**, not in client code.
