/**
 * Parser for the lift-log sheet (Sheet4):
 *   Date | Day | Lift | Weight | Reps | Notes
 *
 * The source is human shorthand: several lifts jammed into one cell,
 * separated by "/", e.g.  Lift="DL / DL / Bench"  Weight="210 / 160 / 120".
 * When the slash-counts line up, we split into one row per exercise.
 * When they don't, we keep the raw text and add a warning so the human
 * fixes it on the import preview screen — we never guess silently.
 */

import { cellToISODate } from "./gridParse";
import type { CellValue, LiftEntry, SheetMatrix } from "./types";

export interface LiftParseResult {
  entries: LiftEntry[];
  warnings: string[];
}

function splitSlash(s: string): string[] {
  return s
    .split("/")
    .map((x) => x.trim())
    .filter((x) => x !== "");
}

function toWeight(v: string): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cellText(v: CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return ""; // Excel mangled this cell (e.g. "1 / 2" became a date) — treat as unusable
  return String(v).trim();
}

export function parseLiftSheet(matrix: SheetMatrix, sheetName = "lifts"): LiftParseResult {
  const entries: LiftEntry[] = [];
  const warnings: string[] = [];

  // find header row
  let headerRow = -1;
  const colIdx: Record<string, number> = {};
  for (let r = 0; r < Math.min(matrix.length, 10); r++) {
    const row = matrix[r] ?? [];
    const lower = row.map((c) => (typeof c === "string" ? c.trim().toLowerCase() : ""));
    if (lower.includes("date") && lower.includes("lift")) {
      headerRow = r;
      for (const name of ["date", "lift", "weight", "reps", "notes"]) {
        colIdx[name] = lower.indexOf(name);
      }
      break;
    }
  }
  if (headerRow === -1) {
    return { entries, warnings: [`${sheetName}: no header row with Date + Lift found`] };
  }

  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const date = cellToISODate(row[colIdx.date] ?? null);
    if (!date) continue;

    const liftRaw = cellText(row[colIdx.lift] ?? null);
    if (liftRaw === "") continue; // rest day

    const weightCell = row[colIdx.weight] ?? null;
    const repsCell = row[colIdx.reps] ?? null;
    const notes = colIdx.notes >= 0 ? cellText(row[colIdx.notes] ?? null) || null : null;

    if (repsCell instanceof Date) {
      warnings.push(`${sheetName}: ${date}: Reps cell was converted to a date by Excel — please re-enter reps`);
    }

    const lifts = splitSlash(liftRaw);
    const weights = typeof weightCell === "number" ? [String(weightCell)] : splitSlash(cellText(weightCell));
    const reps = typeof repsCell === "number" ? [String(repsCell)] : splitSlash(cellText(repsCell));

    if (lifts.length > 1 && weights.length === lifts.length) {
      // clean split: one entry per exercise
      lifts.forEach((name, i) => {
        entries.push({
          date,
          exercise: name,
          weightKg: toWeight(weights[i]),
          reps: reps.length === lifts.length ? reps[i] : reps.join(" / ") || null,
          sets: null,
          notes: i === 0 ? notes : null,
        });
      });
      if (reps.length > 1 && reps.length !== lifts.length) {
        warnings.push(`${sheetName}: ${date}: ${lifts.length} lifts but ${reps.length} reps values — check reps`);
      }
    } else if (lifts.length > 1) {
      warnings.push(
        `${sheetName}: ${date}: cannot line up ${lifts.length} lifts with weight ${JSON.stringify(cellText(weightCell))} — imported as one row, please split manually`
      );
      entries.push({
        date,
        exercise: liftRaw,
        weightKg: typeof weightCell === "number" ? weightCell : null,
        reps: reps.join(" / ") || null,
        sets: null,
        notes,
      });
    } else {
      entries.push({
        date,
        exercise: liftRaw,
        weightKg: typeof weightCell === "number" ? weightCell : toWeight(cellText(weightCell)),
        reps: reps.join(" / ") || null,
        sets: null,
        notes,
      });
    }
  }

  return { entries, warnings };
}
