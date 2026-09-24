-- DayMax migration 46: per-member config on pursuit_members.
--
-- Migration 45 added a per-PURSUIT `pursuits.config jsonb`. That's the right
-- home for pursuit-wide settings (chess template flag, etc), but the chess
-- pursuit also needs PER-MEMBER settings — each member's own chess.com
-- username, and a local cache of the (expensive) Lichess cloud-eval analysis
-- keyed by chess.com game URL so we don't re-hit Lichess for a game we've
-- already scored.
--
-- Shape for the chess template today:
--   {
--     "chess": {
--       "username": "somebody",
--       "cache": {
--         "https://www.chess.com/game/live/12345": {
--           "cpLossPerMove": [12, 5, 200, ...],   -- per-my-move centipawn loss
--           "accuracy": 84,                        -- derived, cached for tiles
--           "analysedAt": "2026-09-24T13:40:00Z"
--         }
--       }
--     }
--   }
--
-- We deliberately DO NOT cache the PGN: chess.com already serves it on every
-- fetch, and the derived cp-loss array is small (dozens of ints per game)
-- whereas a PGN is kilobytes.
--
-- RLS: `pursuit_members` already has the right policies from migration 13:
--   * SELECT `members visible to fellow members or on public pursuits`
--     (fellow members can read each other's config — needed for the pursuit
--      overview tab that averages across all members)
--   * UPDATE `edit own membership` `for update using (user_id = auth.uid())`
--     (each member can write their OWN row's config, nobody else's)
-- Nothing to add here.

alter table public.pursuit_members
  add column if not exists config jsonb not null default '{}'::jsonb;

comment on column public.pursuit_members.config is
  'Per-member, per-pursuit settings + local cache. Shape depends on the pursuit template. '
  'For chess: {chess: {username, cache: {[gameUrl]: {cpLossPerMove, accuracy, analysedAt}}}}.';
