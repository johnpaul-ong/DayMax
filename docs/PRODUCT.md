# DayMax — what it is

DayMax replaces (and round-trips with) a spreadsheet where the owner tracks:

1. **Day** — every day in 96 fifteen-minute slots. Each slot is a parent category (0 Sleep, 1 Work, 2 Sports, 3 Social, 4 Travel, 5 Misc, 6 Other, 7 Eat, 8 Family, 9 Leisure) plus an optional personal label ("thesis", a friend's name). Per-day extras: emotional score, tiredness, start friction, brain fatigue, deep time, weight, notes.
2. **Lifts** — date, exercise, weight, reps, sets, notes.

## The one feature that matters

Logging must be **faster than Excel**: drag a range and type once on desktop, tap big buttons on a phone. If a normal Tuesday takes longer to log in DayMax than in the spreadsheet, DayMax has failed.

## Two ways in, one home

- **Manual** — desktop grid or phone "today" editor and lift logger.
- **Excel/AI** — upload the workbook, paste a grid, or upload JSON produced by ChatGPT/Claude (`docs/DATA_CONTRACT.md`). Always with a preview before saving; last write wins per day *after* the human confirms.

The app is the home. Excel is a dump/export format — the Export page produces a month grid that still looks like the original.

## Compare = productivity ranking (Phase 3)

Not a 96-slot spy grid. Hours in three buckets — **productive** (default Work+Sports), **brainrot** (default Other+Leisure), **other** — for today, this week, all time, plus the productive:brainrot ratio. Both numbers shown so nobody can game one stat. Uses totals only; never raw labels. Bucket assignment is configurable so each friend group can keep it fair.

## Deliberately not in v1

Tape/body measurements (future custom track type), calories, public discovery, comments/likes, native apps, a generic track builder, git-style branching, AI running inside the app.
