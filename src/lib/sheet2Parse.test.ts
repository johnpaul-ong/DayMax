import { describe, expect, it } from "vitest";
import { parseSheet2 } from "./sheet2Parse";
import type { SheetMatrix } from "./types";

const HEADER = ["Date", "Day", "JP", "S", "SR", "B", "BR", "D", "DR", "DBB", "DR", "Rows", "Rows Reos", "Tuna Rice", "Time"];

describe("parseSheet2", () => {
  it("extracts bodyweight, lifts, tuna rice and run time", () => {
    const m: SheetMatrix = [
      [],
      HEADER,
      [new Date(2026, 0, 2), "Fri", 70, null, null, 120, 2, 210, 1, null, null, null, null, null, null],
      [new Date(2026, 0, 6), "Tue", "NA", null, null, null, null, null, null, null, null, null, null, 3, new Date(2000, 0, 1, 5, 20)],
    ];
    const r = parseSheet2(m);
    expect(r.metrics).toContainEqual({ date: "2026-01-02", metric: "bodyweight_kg", value: 70, textValue: null });
    expect(r.lifts).toContainEqual(expect.objectContaining({ date: "2026-01-02", exercise: "Bench", weightKg: 120, reps: "2" }));
    expect(r.lifts).toContainEqual(expect.objectContaining({ exercise: "Deadlift", weightKg: 210, reps: "1" }));
    // NA bodyweight skipped
    expect(r.metrics.filter((x) => x.date === "2026-01-06" && x.metric === "bodyweight_kg")).toHaveLength(0);
    expect(r.metrics).toContainEqual({ date: "2026-01-06", metric: "tuna_rice", value: 3, textValue: null });
    const run = r.metrics.find((x) => x.metric === "run_time_min")!;
    expect(run.value).toBe(320);
  });
});
