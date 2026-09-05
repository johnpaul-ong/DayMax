# Data contract — for ChatGPT / Claude / any agent producing DayMax data

Convert messy spreadsheets or notes into this JSON, then the user uploads the file on the **Import** page. Invalid items are rejected with a reason — never guessed.

Upload a JSON file containing **one object or an array of objects**. Three kinds:

## 1. Time-grid slot

```json
{
  "trackKind": "time_grid",
  "intervalMinutes": 15,
  "date": "2026-03-01",
  "slot": "06:00",
  "category": "work",
  "subcategory": null,
  "label": "rna-seq",
  "notes": null
}
```

- `slot`: "HH:MM" on a 15-minute boundary, or an integer 0–95.
- `category`: one of `sleep, work, sports, social, travel, misc, other, eat, family, leisure` (or the number 0–9).
- One object per slot. A full day = 96 objects.

## 2. Lifting entry

```json
{
  "trackKind": "lifting",
  "date": "2026-01-02",
  "exercises": [{ "name": "deadlift", "weightKg": 210, "reps": 2 }],
  "notes": "RPE 8"
}
```

- `reps` may be a number or a string ("AMRAP", "2 + 10").

## 3. Measurement / daily number

```json
{
  "trackKind": "measurements",
  "date": "2026-01-01",
  "metric": "bodyweight_kg",
  "value": 70.8
}
```

- Known metrics: `bodyweight_kg`, `run_time_min`, `tuna_rice`. New metric names are allowed.

## Validation rules (enforced by the importer)

- Unknown `trackKind` → rejected.
- `time_grid` with a slot off the 15-minute grid or an unknown category → rejected.
- Dates must be `YYYY-MM-DD`.
- Rejections are listed on the preview screen so the human can fix the source.
