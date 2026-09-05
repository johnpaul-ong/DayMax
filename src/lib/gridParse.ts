/**
 * Parser for the "month grid" sheet layout (JAN..AUG, SUM, "Julius APR"):
 *
 *   row with weekday names ("Mon", "Tue", ...)
 *   row with dates, one column per day
 *   96 rows of times 00:00..23:45 in a "time column", day cells = "N Label"
 *   footer rows keyed by text in the column left of the time column:
 *     per-category hours (recomputed, not trusted), Total, Hours Left,
 *     Emotional Score, Tired, Start Friction, End Brain Fatigue,
 *     Deep Start, Deep Time, Weight (kg), Notes
 *
 * Input is a raw cell matrix so this module stays dependency-free and testable.
 */

import { SLOTS_PER_DAY } from "./categories";
import type { CellValue, DayEntry, DayMetrics, SheetMatrix } from "./types";

export interface GridParseResult {
  entries: DayEntry[];
  metrics: DayMetrics[];
  warnings: string[];
}

/** Normalize a cell that should be a time-of-day to minutes since midnight. */
function cellToMinutes(v: CellValue): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getHours() * 60 + v.getMinutes();
  if (typeof v === "number") {
    // Excel time = fraction of a day
    if (v >= 0 && v < 1) return Math.round(v * 24 * 60);
    return null;
  }
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v).trim());
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return null;
}

/** Normalize a cell that should be a date to ISO yyyy-mm-dd. */
export function cellToISODate(v: CellValue): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    if (y < 2000 || y > 2100) return null;
    return `${y}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
    if (m) return m[0].slice(0, 10);
  }
  return null;
}

/** Parse one grid cell like "6 Fucking around", "0 Sleep", "3 Mary", "7". */
export function parseGridCell(v: CellValue): { category: number; label: string | null } | null {
  if (v == null) return null;
  if (typeof v === "number") {
    if (Number.isInteger(v) && v >= 0 && v <= 9) return { category: v, label: null };
    return null;
  }
  const s = String(v).trim();
  if (s === "") return null;
  const m = /^(\d)\s*(.*)$/.exec(s);
  if (!m) return null;
  const category = Number(m[1]);
  const label = m[2].trim();
  return { category, label: label === "" ? null : label };
}

/**
 * Find the time column and the row index of the 00:00 cell by looking for a
 * column that contains a run of 96 increasing 15-minute times.
 */
function findTimeColumn(matrix: SheetMatrix): { col: number; startRow: number } | null {
  const maxScanCols = 8;
  const maxScanRows = Math.min(matrix.length, 30);
  for (let c = 0; c < maxScanCols; c++) {
    for (let r = 0; r < maxScanRows; r++) {
      if (cellToMinutes(matrix[r]?.[c] ?? null) !== 0) continue;
      // verify a decent run of +15 increments
      let ok = true;
      for (let i = 0; i < 12; i++) {
        if (cellToMinutes(matrix[r + i]?.[c] ?? null) !== i * 15) {
          ok = false;
          break;
        }
      }
      if (ok) return { col: c, startRow: r };
    }
  }
  return null;
}

const METRIC_KEYS: Array<{ match: (k: string) => boolean; field: keyof Omit<DayMetrics, "date" | "notes"> }> = [
  { match: (k) => k.startsWith("emotional score"), field: "emotionalScore" },
  { match: (k) => k === "tired", field: "tired" },
  { match: (k) => k === "start friction", field: "startFriction" },
  { match: (k) => k === "end brain fatigue", field: "endBrainFatigue" },
  { match: (k) => k === "deep time", field: "deepTime" },
  { match: (k) => k.startsWith("weight"), field: "weightKg" },
];

export function parseMonthGrid(matrix: SheetMatrix, sheetName = "sheet"): GridParseResult {
  const warnings: string[] = [];
  const entries: DayEntry[] = [];
  const metricsByDate = new Map<string, DayMetrics>();

  const time = findTimeColumn(matrix);
  if (!time) {
    return { entries, metrics: [], warnings: [`${sheetName}: no 00:00..23:45 time column found — not a month grid`] };
  }
  const { col: timeCol, startRow } = time;
  const dateRow = startRow - 1;

  // Day columns = columns right of the time column whose dateRow cell is a date
  const dayCols: Array<{ col: number; date: string }> = [];
  const rowLen = Math.max(...matrix.slice(0, startRow + 2).map((r) => r?.length ?? 0));
  for (let c = timeCol + 1; c < rowLen; c++) {
    const iso = cellToISODate(matrix[dateRow]?.[c] ?? null);
    if (iso) dayCols.push({ col: c, date: iso });
  }
  if (dayCols.length === 0) {
    return { entries, metrics: [], warnings: [`${sheetName}: time column found but no date columns`] };
  }

  // Grid cells
  for (const { col, date } of dayCols) {
    for (let s = 0; s < SLOTS_PER_DAY; s++) {
      const raw = matrix[startRow + s]?.[col] ?? null;
      if (raw == null || String(raw).trim() === "") continue;
      const parsed = parseGridCell(raw);
      if (!parsed || parsed.category > 9) {
        warnings.push(`${sheetName}: ${date} slot ${s}: cannot parse cell ${JSON.stringify(String(raw))}`);
        continue;
      }
      entries.push({ date, slot: s, category: parsed.category, label: parsed.label });
    }
  }

  // Footer metrics: rows after the last time row, keyed by text one column left of the time column
  const keyCol = Math.max(0, timeCol - 1);
  const emptyMetrics = (date: string): DayMetrics => ({
    date,
    emotionalScore: null,
    tired: null,
    startFriction: null,
    endBrainFatigue: null,
    deepTime: null,
    weightKg: null,
    notes: null,
  });
  for (let r = startRow + SLOTS_PER_DAY; r < matrix.length; r++) {
    const keyRaw = matrix[r]?.[keyCol];
    if (keyRaw == null) continue;
    const key = String(keyRaw).trim().toLowerCase();
    if (key === "") continue;

    if (key === "notes") {
      for (const { col, date } of dayCols) {
        const v = matrix[r]?.[col];
        if (v != null && String(v).trim() !== "") {
          const m = metricsByDate.get(date) ?? emptyMetrics(date);
          m.notes = String(v).trim();
          metricsByDate.set(date, m);
        }
      }
      continue;
    }

    const metric = METRIC_KEYS.find((mk) => mk.match(key));
    if (!metric) continue; // category-hour rows, Total, Hours Left, Deep Start etc. are recomputed or ignored
    for (const { col, date } of dayCols) {
      const v = matrix[r]?.[col];
      if (typeof v !== "number") continue;
      const m = metricsByDate.get(date) ?? emptyMetrics(date);
      (m[metric.field] as number | null) = v;
      metricsByDate.set(date, m);
    }
  }

  return { entries, metrics: [...metricsByDate.values()], warnings };
}
