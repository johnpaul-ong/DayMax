# Architecture

- **Next.js 14 (App Router) + TypeScript + Tailwind**, hosted on Vercel.
- **Supabase** for auth (email/password + magic link) and Postgres with **row-level security on every table** (`user_id = auth.uid()`).
- **SheetJS (`xlsx`)** in the browser for import/export — spreadsheet bytes never touch a server we run.
- **Recharts** for graphs.

## Layers

```
src/lib/          pure logic — no React, no Supabase, unit-tested
  categories.ts   parent categories, buckets, slot<->time helpers
  gridParse.ts    month-grid matrix -> DayEntry[] + DayMetrics[]
  liftParse.ts    lift sheet -> LiftEntry[] (slash-splitting, warnings)
  sheet2Parse.ts  daily-numbers sheet -> DailyMetric[] + LiftEntry[]
  ranking.ts      bucket totals, ratio, day/week/all-time windows
  xlsxIO.ts       (browser) SheetJS wrapper: file -> matrices, export builder
  data.ts         (browser) all Supabase reads/writes
  supabase/       client + server helpers (@supabase/ssr)
src/app/          pages; every page is a thin shell over lib functions
src/middleware.ts session refresh + redirect-to-signin
```

## Auth flow

Middleware refreshes the session cookie on every request and redirects signed-out users to `/signin`. Magic-link emails land on `/auth/callback` which exchanges the code for a session. Password login exists because magic links die in spam filters.

## Why parsers take matrices, not files

`gridParse`/`liftParse`/`sheet2Parse` accept `CellValue[][]` so they can be tested without SheetJS and were validated against the owner's real workbook. Only `xlsxIO.ts` imports the `xlsx` library.

## Security posture

- RLS on every table; the anon key is safe to expose because RLS is the enforcement layer.
- No service-role key anywhere in this repo.
- Import preview means no silent writes.
- Phase 3 sharing must be a *server-checked* allowlist (share rules per member per track), never client-side filtering. See ROADMAP.
