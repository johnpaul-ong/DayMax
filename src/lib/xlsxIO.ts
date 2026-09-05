"use client";

/**
 * Browser-side Excel I/O using SheetJS. This is the only module that touches
 * the xlsx library; parsers work on plain matrices so they stay testable.
 */

import * as XLSX from "xlsx";
import { CATEGORIES, categoryName, slotToTime, SLOTS_PER_DAY } from "./categories";
import { parseMonthGrid, type GridParseResult } from "./gridParse";
import { parseLiftSheet, type LiftParseResult } from "./liftParse";
import { parseSheet2, type Sheet2ParseResult } from "./sheet2Parse";
import type { DayEntry, DayMetrics, SheetMatrix } from "./types";

export interface WorkbookParseResult {
  grids: Array<{ sheet: string } & GridParseResult>;
  lifts: Array<{ sheet: string } & LiftParseResult>;
  daily: Array<{ sheet: string } & Sheet2ParseResult>;
  skipped: string[];
}

function sheetToMatrix(ws: XLSX.WorkSheet): SheetMatrix {
  return XLSX.utils.sheet_to_json<any[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
  }) as SheetMatrix;
}

function looksLikeGrid(m: SheetMatrix): boolean {
  // a column containing a 00:00 cell followed by 00:15
  for (let c = 0; c < 8; c++) {
    for (let r = 0; r < Math.min(m.length, 20); r++) {
      const v = m[r]?.[c];
      const isMidnight =
        (v instanceof Date && v.getHours() === 0 && v.getMinutes() === 0) || v === 0;
      if (!isMidnight && !(typeof v === "string" && /^0?0:00/.test(v))) continue;
      const nx = m[r + 1]?.[c];
      if (nx instanceof Date && nx.getHours() === 0 && nx.getMinutes() === 15) return true;
      if (typeof nx === "number" && Math.round(nx * 24 * 60) === 15) return true;
    }
  }
  return false;
}

function headerNames(m: SheetMatrix): string[] {
  const out: string[] = [];
  for (let r = 0; r < Math.min(m.length, 10); r++) {
    for (const c of m[r] ?? []) if (typeof c === "string") out.push(c.trim().toLowerCase());
  }
  return out;
}

/** Parse an uploaded workbook file into DayMax data with per-sheet results. */
export async function parseWorkbook(file: File): Promise<WorkbookParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const result: WorkbookParseResult = { grids: [], lifts: [], daily: [], skipped: [] };

  for (const name of wb.SheetNames) {
    const m = sheetToMatrix(wb.Sheets[name]);
    if (m.length === 0) {
      result.skipped.push(name);
      continue;
    }
    const heads = headerNames(m);
    if (looksLikeGrid(m)) {
      result.grids.push({ sheet: name, ...parseMonthGrid(m, name) });
    } else if (heads.includes("lift")) {
      result.lifts.push({ sheet: name, ...parseLiftSheet(m, name) });
    } else if (heads.includes("jp") && heads.includes("date")) {
      result.daily.push({ sheet: name, ...parseSheet2(m, name) });
    } else {
      result.skipped.push(name); // e.g. Sheet1 tape snapshot — out of v1
    }
  }
  return result;
}

/** Parse a pasted TSV grid (copied straight out of Excel) as one month grid. */
export function parsePastedGrid(tsv: string): GridParseResult {
  const matrix: SheetMatrix = tsv
    .split(/\r?\n/)
    .map((line) => line.split("\t").map((cell) => (cell.trim() === "" ? null : cell)));
  return parseMonthGrid(matrix, "pasted");
}

/** Build a month-grid .xlsx that looks like the original spreadsheet. */
export function buildMonthGridXlsx(
  ym: string,
  entries: DayEntry[],
  metrics: DayMetrics[]
): Blob {
  const [y, mo] = ym.split("-").map(Number);
  const daysInMonth = new Date(y, mo, 0).getDate();
  const dates = Array.from({ length: daysInMonth }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
  const byKey = new Map(entries.map((e) => [`${e.date}|${e.slot}`, e]));
  const metByDate = new Map(metrics.map((m) => [m.date, m]));

  const aoa: (string | number | null)[][] = [];
  aoa.push([]); // row 1 empty like the original
  aoa.push([null, null, null, ...dates.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(d + "T00:00:00").getDay()])]);
  aoa.push([null, null, null, ...dates]);
  for (let s = 0; s < SLOTS_PER_DAY; s++) {
    aoa.push([
      null,
      null,
      slotToTime(s),
      ...dates.map((d) => {
        const e = byKey.get(`${d}|${s}`);
        return e ? `${e.category}${e.label ? " " + e.label : ""}` : null;
      }),
    ]);
  }
  // footer: recomputed hours per category + metrics
  for (const cat of CATEGORIES) {
    aoa.push([
      null,
      `${cat.code} ${categoryName(cat.code)}`,
      null,
      ...dates.map((d) => {
        let n = 0;
        for (let s = 0; s < SLOTS_PER_DAY; s++) if (byKey.get(`${d}|${s}`)?.category === cat.code) n++;
        return n === 0 ? null : n / 4;
      }),
    ]);
  }
  const metricRows: Array<[string, (m: DayMetrics) => number | string | null]> = [
    ["Emotional Score", (m) => m.emotionalScore],
    ["Tired", (m) => m.tired],
    ["Start Friction", (m) => m.startFriction],
    ["End Brain Fatigue", (m) => m.endBrainFatigue],
    ["Deep Time", (m) => m.deepTime],
    ["Weight (kg)", (m) => m.weightKg],
    ["Notes", (m) => m.notes],
  ];
  for (const [label, get] of metricRows) {
    aoa.push([null, label, null, ...dates.map((d) => (metByDate.has(d) ? get(metByDate.get(d)!) : null))]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, ym);
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
