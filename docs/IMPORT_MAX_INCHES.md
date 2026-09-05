# How the owner's real workbook maps to DayMax

Source: `main_max_inches_desktop_copy.xlsx` (kept local, **never committed**). A sanitized copy of the layouts lives in `fixtures/sample_workbook.xlsx`.

## Month grid sheets (`JAN`…`AUG`, `SUM`, `Julius APR`)

- Row 2: weekday names. Row 3: dates (one column per day). Column C: times 00:00–23:45.
- Grid cells: `"{category} {optional label}"` — e.g. `0 Sleep`, `1 thesis`, `3 Mary`, `6  GC` (double spaces happen).
- Legacy category names map to shared parents: `2 Gym / Judo` → **2 Sports**, `6 Fucking Around / Other` → **6 Other**. `9 Leisure` only exists in later months.
- Footer rows (keyed by column B): per-category hours (**recomputed, not imported**), Total, Hours Left, Emotional Score, Tired, Start Friction, End Brain Fatigue, Deep Start (ignored), Deep Time, Weight (kg), Notes → `day_metrics`.
- Cells with no leading number (e.g. `Shower`, and many in `Julius APR`) are **warnings** on the preview screen, not imported.
- Note: `JAN`/`SUM` dates are 2025; later sheets are 2026. The date row is the source of truth — sheet names are decoration.

## `Sheet4` — lift log

`Date | Day | Lift | Weight | Reps | Notes`. Human shorthand: `DL / DL / Bench` + `210 / 160 / 120` in single cells → split into one entry per exercise when slash-counts line up; otherwise imported as one row with a warning. One reps cell was silently converted to a date by Excel (`1 / 2` → 2026-03-01); the importer flags it for manual re-entry.

## `Sheet2` — daily numbers

`Date | Day | JP | S | SR | B | BR | D | DR | DBB | DR | Rows | Rows Reos | Tuna Rice | Time`
→ JP = `bodyweight_kg`; the weight/rep pairs become lift entries (Squat, Bench, Deadlift, Dumbbell Bench, Rows); Tuna Rice = `tuna_rice`; Time = `run_time_min`. `NA` cells skipped.

## `Sheet1` — tape/inches friend snapshot

**Skipped.** Body measurements wait for custom track types (see ROADMAP). Contains friends' personal data — extra reason it stays out.
