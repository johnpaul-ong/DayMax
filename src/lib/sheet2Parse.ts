/**
 * Parser for the daily-numbers sheet (Sheet2):
 *   Date | Day | JP | S | SR | B | BR | D | DR | DBB | DR | Rows | Rows Reos | Tuna Rice | Time
 *
 * JP           -> daily metric bodyweight_kg
 * S/SR         -> lift entry Squat (weight/reps)
 * B/BR         -> Bench
 * D/DR         -> Deadlift
 * DBB/DR(2nd)  -> Dumbbell Bench
 * Rows/RowsReos-> Rows
 * Tuna Rice    -> daily metric tuna_rice
 * Time         -> daily metric run_time_min (from an Excel time cell)
 * "NA" cells are skipped.
 */

import { cellToISODate } from "./gridParse";
import type { CellValue, DailyMetric, LiftEntry, SheetMatrix } from "./types";

export interface Sheet2ParseResult {
  metrics: DailyMetric[];
  lifts: LiftEntry[];
  warnings: string[];
}

function num(v: CellValue): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "" || s.toUpperCase() === "NA") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function minutes(v: CellValue): number | null {
  if (v instanceof Date) return v.getHours() * 60 + v.getMinutes() + v.getSeconds() / 60;
  if (typeof v === "number" && v > 0 && v < 1) return v * 24 * 60;
  if (typeof v === "string") {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v.trim());
    if (m) return Number(m[1]) * 60 + Number(m[2]) + Number(m[3] ?? 0) / 60;
  }
  return null;
}

const LIFT_PAIRS: Array<{ w: string; r: string; name: string }> = [
  { w: "s", r: "sr", name: "Squat" },
  { w: "b", r: "br", name: "Bench" },
  { w: "d", r: "dr", name: "Deadlift" },
  { w: "dbb", r: "dr2", name: "Dumbbell Bench" },
  { w: "rows", r: "rows reos", name: "Rows" },
];

export function parseSheet2(matrix: SheetMatrix, sheetName = "daily"): Sheet2ParseResult {
  const metrics: DailyMetric[] = [];
  const lifts: LiftEntry[] = [];
  const warnings: string[] = [];

  // header row: contains "Date" and "JP"
  let headerRow = -1;
  const cols: Record<string, number> = {};
  for (let r = 0; r < Math.min(matrix.length, 10); r++) {
    const lower = (matrix[r] ?? []).map((c) => (typeof c === "string" ? c.trim().toLowerCase() : ""));
    if (lower.includes("date") && lower.includes("jp")) {
      headerRow = r;
      let seenDr = false;
      lower.forEach((name, i) => {
        if (name === "") return;
        if (name === "dr") {
          cols[seenDr ? "dr2" : "dr"] = i;
          seenDr = true;
          return;
        }
        cols[name] = i;
      });
      break;
    }
  }
  if (headerRow === -1) {
    return { metrics, lifts, warnings: [`${sheetName}: no header row with Date + JP found`] };
  }

  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const date = cellToISODate(row[cols.date] ?? null);
    if (!date) continue;

    const bw = num(row[cols.jp] ?? null);
    if (bw != null) metrics.push({ date, metric: "bodyweight_kg", value: bw, textValue: null });

    for (const p of LIFT_PAIRS) {
      if (!(p.w in cols)) continue;
      const w = num(row[cols[p.w]] ?? null);
      const reps = p.r in cols ? num(row[cols[p.r]] ?? null) : null;
      if (w == null && reps == null) continue;
      lifts.push({
        date,
        exercise: p.name,
        weightKg: w,
        reps: reps != null ? String(reps) : null,
        sets: null,
        notes: "from daily numbers sheet",
      });
    }

    if ("tuna rice" in cols) {
      const v = num(row[cols["tuna rice"]] ?? null);
      if (v != null) metrics.push({ date, metric: "tuna_rice", value: v, textValue: null });
    }
    if ("time" in cols) {
      const v = minutes(row[cols.time] ?? null);
      if (v != null) metrics.push({ date, metric: "run_time_min", value: Math.round(v * 100) / 100, textValue: null });
    }
  }

  return { metrics, lifts, warnings };
}
