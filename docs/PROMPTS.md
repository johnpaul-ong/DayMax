# Copy-paste prompts for ChatGPT / Claude

## Turn a spreadsheet into DayMax JSON

> I'm attaching a spreadsheet with my daily time tracking. Convert it to DayMax JSON: an array of objects following this contract:
>
> - Time slots: `{"trackKind":"time_grid","intervalMinutes":15,"date":"YYYY-MM-DD","slot":"HH:MM","category":"work","label":"optional text"}` — categories are exactly: sleep, work, sports, social, travel, misc, other, eat, family, leisure. One object per 15-minute slot.
> - Lifts: `{"trackKind":"lifting","date":"YYYY-MM-DD","exercises":[{"name":"deadlift","weightKg":210,"reps":2}],"notes":null}`
> - Daily numbers: `{"trackKind":"measurements","date":"YYYY-MM-DD","metric":"bodyweight_kg","value":70.8}`
>
> Rules: never invent data for slots that are empty in the source; if a cell is ambiguous, skip it and list it at the end for me to check; map "Gym/Judo" to "sports" and "Fucking around" to "other". Output a single JSON file I can download.

## Summarize my week from a DayMax export

> Here is a DayMax month export (.xlsx). The grid is: row 3 = dates, column C = times in 15-minute steps, cells = "category label". Give me: total hours per category per day, my productive (work+sports) vs brainrot (other+leisure) ratio per day, and any patterns you notice. Don't quote individual labels back at me in the summary.

## Log from natural language

> Convert this diary text into DayMax time_grid JSON for 2026-09-05: "slept till 7, gym 7:30–9, worked 9:30–13, lunch with Sam till 14, worked till 18, scrolled till 19, dinner, family evening, bed at 23." Fill every 15-minute slot between 00:00 and 23:45; use sleep for the night. List any time ranges you had to guess.
