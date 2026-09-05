import { describe, expect, it } from "vitest";
import { parseGridCell, parseMonthGrid, cellToISODate } from "./gridParse";
import type { SheetMatrix } from "./types";

/** Build a tiny month-grid matrix in the real workbook's layout. */
function makeGrid(): SheetMatrix {
  const rows: SheetMatrix = [];
  rows.push([]); // row 1 empty
  rows.push([null, null, null, "Mon", "Tue"]); // weekday row
  rows.push([null, null, null, new Date(2026, 8, 7), new Date(2026, 8, 8)]); // dates 2026-09-07/08
  for (let s = 0; s < 96; s++) {
    const h = Math.floor(s / 4);
    const m = (s % 4) * 15;
    const time = new Date(2000, 0, 1, h, m);
    const monCell = s < 26 ? "0 Sleep" : s < 60 ? "1 thesis" : "9 Leisure";
    const tueCell = s < 26 ? "0" : "2 judo";
    rows.push([null, null, time, monCell, tueCell]);
  }
  // footer
  rows.push([null, "0 Sleep", null, 6.5, 6.5]);
  rows.push([null, "Emotional Score / 10", null, 8, 6]);
  rows.push([null, "Tired", null, 3, 7]);
  rows.push([null, "Weight (kg)", null, 70.5, null]);
  rows.push([null, "Notes", null, "good day", null]);
  return rows;
}

describe("parseGridCell", () => {
  it("parses category + label", () => {
    expect(parseGridCell("6 Fucking around")).toEqual({ category: 6, label: "Fucking around" });
    expect(parseGridCell("3 Mary")).toEqual({ category: 3, label: "Mary" });
    expect(parseGridCell("6  GC")).toEqual({ category: 6, label: "GC" }); // double space
  });
  it("parses bare numbers", () => {
    expect(parseGridCell("7")).toEqual({ category: 7, label: null });
    expect(parseGridCell(4)).toEqual({ category: 4, label: null });
  });
  it("rejects label-only cells (no silent guessing)", () => {
    expect(parseGridCell("Shower")).toBeNull();
    expect(parseGridCell("Grow group")).toBeNull();
  });
});

describe("cellToISODate", () => {
  it("converts Date objects", () => {
    expect(cellToISODate(new Date(2026, 0, 2))).toBe("2026-01-02");
  });
  it("rejects junk", () => {
    expect(cellToISODate("hello")).toBeNull();
    expect(cellToISODate(42)).toBeNull();
  });
});

describe("parseMonthGrid", () => {
  const result = parseMonthGrid(makeGrid(), "TEST");

  it("finds both day columns and all 96 slots", () => {
    expect(result.entries.filter((e) => e.date === "2026-09-07")).toHaveLength(96);
    expect(result.entries.filter((e) => e.date === "2026-09-08")).toHaveLength(96);
  });
  it("parses categories and labels", () => {
    const first = result.entries.find((e) => e.date === "2026-09-07" && e.slot === 0)!;
    expect(first).toMatchObject({ category: 0, label: "Sleep" });
    const work = result.entries.find((e) => e.date === "2026-09-07" && e.slot === 30)!;
    expect(work).toMatchObject({ category: 1, label: "thesis" });
    const bare = result.entries.find((e) => e.date === "2026-09-08" && e.slot === 0)!;
    expect(bare).toMatchObject({ category: 0, label: null });
  });
  it("reads footer metrics but ignores category-hour rows", () => {
    const m7 = result.metrics.find((m) => m.date === "2026-09-07")!;
    expect(m7.emotionalScore).toBe(8);
    expect(m7.tired).toBe(3);
    expect(m7.weightKg).toBe(70.5);
    expect(m7.notes).toBe("good day");
    const m8 = result.metrics.find((m) => m.date === "2026-09-08")!;
    expect(m8.weightKg).toBeNull();
  });
  it("returns a warning, not garbage, for a non-grid sheet", () => {
    const bad = parseMonthGrid([["Age", 23], ["Height", 171]], "Sheet1");
    expect(bad.entries).toHaveLength(0);
    expect(bad.warnings.length).toBeGreaterThan(0);
  });
});
