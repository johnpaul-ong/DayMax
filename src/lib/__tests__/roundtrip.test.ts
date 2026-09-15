import { describe, expect, it } from "vitest";
import { findTimeColumn, parseMonthGrid } from "../gridParse";
import { slotToTime, SLOTS_PER_DAY } from "../categories";
import type { SheetMatrix } from "../types";

/**
 * The regression that mattered: buildMonthGridXlsx writes slotToTime(), which
 * returns STRINGS. looksLikeGrid required the second time cell to be a Date or
 * a number, so every file DayMax exported was skipped by DayMax's own importer.
 */
function exportShapedSheet(): SheetMatrix {
  const dates = ["2026-01-01", "2026-01-02"];
  const m: SheetMatrix = [];
  m.push([]);
  m.push([null, null, null, "Thu", "Fri"]);
  m.push([null, null, null, ...dates]);
  for (let s = 0; s < SLOTS_PER_DAY; s++) {
    m.push([null, null, slotToTime(s), s < 4 ? "0 Sleep" : null, "1 Work"]);
  }
  return m;
}

describe("export -> import round trip", () => {
  it("recognises string times, the way slotToTime writes them", () => {
    expect(findTimeColumn(exportShapedSheet())).toEqual({ col: 2, startRow: 3 });
  });

  it("still recognises Excel serial times", () => {
    const m = exportShapedSheet();
    for (let s = 0; s < SLOTS_PER_DAY; s++) m[3 + s][2] = (s * 15) / (24 * 60);
    expect(findTimeColumn(m)).not.toBeNull();
  });

  it("still recognises real Date cells", () => {
    const m = exportShapedSheet();
    for (let s = 0; s < SLOTS_PER_DAY; s++) {
      m[3 + s][2] = new Date(2026, 0, 1, Math.floor(s / 4), (s % 4) * 15);
    }
    expect(findTimeColumn(m)).not.toBeNull();
  });

  it("parses what it recognises", () => {
    const { entries, warnings } = parseMonthGrid(exportShapedSheet(), "2026-01");
    expect(warnings).toEqual([]);
    expect(entries.filter((e) => e.date === "2026-01-01")).toHaveLength(4);
    expect(entries.filter((e) => e.date === "2026-01-02")).toHaveLength(SLOTS_PER_DAY);
    expect(entries[0]).toMatchObject({ date: "2026-01-01", slot: 0, category: 0, label: "Sleep" });
  });

  it("rejects a sheet with no time column", () => {
    expect(findTimeColumn([["Code", "Category"], [0, "Sleep"], [1, "Work"]])).toBeNull();
  });
});
