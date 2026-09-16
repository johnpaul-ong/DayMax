import { describe, expect, it } from "vitest";
import { bigThreeSeries, bigThreeSummary, classifyLift } from "../liftGroups";

describe("classifyLift", () => {
  it("catches the usual spellings", () => {
    for (const s of ["Squat", "back squat", "Front Squat", "BS", "squats"]) expect(classifyLift(s)).toBe("squat");
    for (const s of ["Deadlift", "dead lift", "Deads", "RDL", "Romanian Deadlift", "DL"]) expect(classifyLift(s)).toBe("deadlift");
    for (const s of ["Bench", "Bench Press", "chest press", "BP", "incline bench"]) expect(classifyLift(s)).toBe("bench");
  });

  it("does not fold accessories into the big three", () => {
    // these all contain a root word and are NOT the lift
    expect(classifyLift("Bench Pull")).toBeNull();
    expect(classifyLift("Chest Flies")).toBeNull();
    expect(classifyLift("Leg Press")).toBeNull();
    expect(classifyLift("Calf Raise")).toBeNull();
    expect(classifyLift("Pull Ups")).toBeNull();
    expect(classifyLift("Hack Squat")).toBeNull();
  });

  it("ignores things it does not know", () => {
    expect(classifyLift("Judo")).toBeNull();
    expect(classifyLift("")).toBeNull();
    expect(classifyLift("   ")).toBeNull();
  });
});

describe("bigThreeSeries", () => {
  it("carries each lift forward, since you rarely do all three in a day", () => {
    const s = bigThreeSeries([
      { date: "2026-01-01", exercise: "Squat", weightKg: 100 },
      { date: "2026-01-02", exercise: "Bench", weightKg: 80 },
      { date: "2026-01-03", exercise: "Deadlift", weightKg: 140 },
    ]);
    expect(s).toHaveLength(3);
    expect(s[0].total).toBeNull(); // one lift is not a total
    expect(s[1].total).toBeNull(); // two lifts is not a total either
    expect(s[2]).toMatchObject({ squat: 100, bench: 80, deadlift: 140, total: 320 });
  });

  it("keeps the best, never a later lighter session", () => {
    const s = bigThreeSeries([
      { date: "2026-01-01", exercise: "Squat", weightKg: 120 },
      { date: "2026-01-02", exercise: "Squat", weightKg: 90 }, // deload
    ]);
    expect(s[1].squat).toBe(120);
  });

  it("takes the heaviest set of a day", () => {
    const s = bigThreeSeries([
      { date: "2026-01-01", exercise: "Squat", weightKg: 90 },
      { date: "2026-01-01", exercise: "Back Squat", weightKg: 110 },
    ]);
    expect(s[0].squat).toBe(110);
  });

  it("skips entries with no weight", () => {
    expect(bigThreeSeries([{ date: "2026-01-01", exercise: "Squat", weightKg: null }])).toEqual([]);
  });
});

describe("bigThreeSummary", () => {
  const rows = [
    { date: "2026-01-01", exercise: "Squat", weightKg: 100 },
    { date: "2026-01-02", exercise: "Bench", weightKg: 80 },
    { date: "2026-01-03", exercise: "Deads", weightKg: 140 },
  ];

  it("totals and reports coverage", () => {
    const s = bigThreeSummary(rows);
    expect(s).toMatchObject({ squat: 100, bench: 80, deadlift: 140, total: 320, covered: 3 });
  });

  it("gives relative strength when bodyweight is known", () => {
    expect(bigThreeSummary(rows, 80).relative).toBe(4);
    expect(bigThreeSummary(rows).relative).toBeNull();
    expect(bigThreeSummary(rows, 0).relative).toBeNull(); // no divide by zero
  });

  it("refuses a total when a lift is missing", () => {
    const s = bigThreeSummary(rows.slice(0, 2));
    expect(s.total).toBeNull();
    expect(s.covered).toBe(2);
  });
});
