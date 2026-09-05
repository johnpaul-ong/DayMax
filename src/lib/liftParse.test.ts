import { describe, expect, it } from "vitest";
import { parseLiftSheet } from "./liftParse";
import type { SheetMatrix } from "./types";

const HEADER = ["Date", "Day", "Lift", "Weight", "Reps", "Notes"];

describe("parseLiftSheet", () => {
  it("splits slash-jammed multi-lift rows into one entry per exercise", () => {
    const m: SheetMatrix = [
      HEADER,
      [new Date(2026, 0, 2), "Friday", "DL / DL / Bench", "210 / 160 / 120", "2 / 2 / 5", "5km run"],
    ];
    const r = parseLiftSheet(m);
    expect(r.entries).toHaveLength(3);
    expect(r.entries[0]).toMatchObject({ exercise: "DL", weightKg: 210, reps: "2", notes: "5km run" });
    expect(r.entries[2]).toMatchObject({ exercise: "Bench", weightKg: 120, reps: "5", notes: null });
  });

  it("keeps AMRAP and text reps as text", () => {
    const m: SheetMatrix = [HEADER, [new Date(2026, 0, 3), "Sat", "Squat", 115, "AMRAP", "120x2 110x2"]];
    const r = parseLiftSheet(m);
    expect(r.entries[0]).toMatchObject({ exercise: "Squat", weightKg: 115, reps: "AMRAP" });
  });

  it("warns instead of guessing when a reps cell was mangled into a date by Excel", () => {
    const m: SheetMatrix = [HEADER, [new Date(2026, 0, 2), "Fri", "DL / Bench", "210 / 120", new Date(2026, 2, 1), null]];
    const r = parseLiftSheet(m);
    expect(r.warnings.some((w) => w.includes("converted to a date"))).toBe(true);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0].reps).toBeNull();
  });

  it("warns when lifts and weights cannot be lined up", () => {
    const m: SheetMatrix = [HEADER, [new Date(2026, 0, 8), "Thu", "Deadlift + Pullups + Light Pull", "215 / 25", "2 + 10", null]];
    const r = parseLiftSheet(m);
    // "Deadlift + Pullups + Light Pull" has no "/" so it's one lift with 2 weights
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].exercise).toContain("Deadlift");
  });

  it("skips rest days (no lift)", () => {
    const m: SheetMatrix = [HEADER, [new Date(2026, 0, 1), "Thursday", null, null, null, null]];
    expect(parseLiftSheet(m).entries).toHaveLength(0);
  });
});
