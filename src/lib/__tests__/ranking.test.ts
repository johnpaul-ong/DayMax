import { describe, expect, it } from "vitest";
import { bucketize, emptyTotals, focusScore, hoursByCategory, weekStart, workMax, workMaxFrom } from "../ranking";
import { defaultBuckets } from "../categories";

describe("focusScore", () => {
  it("is null when nothing scoreable was logged", () => {
    expect(focusScore({ productive: 0, brainrot: 0, other: 8 })).toBeNull();
  });

  it("hits 100 when there is no brainrot — the flaw WorkMax exists to cover", () => {
    expect(focusScore({ productive: 3, brainrot: 0, other: 0 })).toBe(100);
    expect(focusScore({ productive: 40, brainrot: 0, other: 0 })).toBe(100);
  });

  it("is 0 when everything scoreable was brainrot", () => {
    expect(focusScore({ productive: 0, brainrot: 5, other: 0 })).toBe(0);
  });

  it("ignores 'other' entirely", () => {
    const a = focusScore({ productive: 4, brainrot: 4, other: 0 });
    const b = focusScore({ productive: 4, brainrot: 4, other: 16 });
    expect(a).toBe(50);
    expect(b).toBe(50);
  });
});

describe("workMax", () => {
  it("separates two people who both score 100 on focus", () => {
    // this is the exact complaint that motivated the metric: Tony 31h and
    // Thor 79h both scored 100, which told you nothing
    expect(workMax({ productive: 31, brainrot: 0, other: 0 })).toBe(31);
    expect(workMax({ productive: 79, brainrot: 0, other: 0 })).toBe(79);
  });

  it("penalises brainrot multiplicatively, not additively", () => {
    // 80% quality x 79h
    expect(workMaxFrom(79, 19.75)).toBeCloseTo(63.2, 1);
  });

  it("is null, not NaN, on an empty day", () => {
    expect(workMax(emptyTotals())).toBeNull();
    expect(workMaxFrom(0, 0)).toBeNull();
  });

  it("never exceeds productive hours", () => {
    for (const [p, b] of [[10, 0], [10, 5], [10, 100], [0.25, 0]]) {
      const w = workMaxFrom(p, b);
      if (w !== null) expect(w).toBeLessThanOrEqual(p + 1e-9);
    }
  });
});

describe("weekStart", () => {
  it("returns Monday for every day of one week, including Sunday", () => {
    // 2026-09-07 is a Monday
    const days = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"];
    for (const d of days) expect(weekStart(d)).toBe("2026-09-07");
  });

  it("rolls back across a month boundary", () => {
    expect(weekStart("2026-10-01")).toBe("2026-09-28");
  });
});

describe("bucketize + hoursByCategory", () => {
  it("counts each slot as 15 minutes", () => {
    const entries = [{ category: 1 }, { category: 1 }, { category: 9 }];
    const hours = hoursByCategory(entries);
    expect(hours[1]).toBe(0.5);
    expect(hours[9]).toBe(0.25);
  });

  it("maps categories to buckets using the defaults", () => {
    const totals = bucketize({ 1: 4, 2: 1, 6: 2, 9: 1, 0: 8 }, defaultBuckets());
    expect(totals.productive).toBe(5); // work + sports
    expect(totals.brainrot).toBe(3); // other + leisure
    expect(totals.other).toBe(8); // sleep
  });
});
