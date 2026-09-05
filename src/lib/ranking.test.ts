import { describe, expect, it } from "vitest";
import { defaultBuckets } from "./categories";
import { bucketize, computeRanking, hoursByCategory, productiveRatio, weekStart } from "./ranking";
import type { DayEntry } from "./types";

function slots(date: string, category: number, count: number, offset = 0): DayEntry[] {
  return Array.from({ length: count }, (_, i) => ({ date, slot: offset + i, category, label: null }));
}

describe("ranking", () => {
  it("defaults: Work+Sports productive, Other+Leisure brainrot", () => {
    const b = defaultBuckets();
    expect(b[1]).toBe("productive");
    expect(b[2]).toBe("productive");
    expect(b[6]).toBe("brainrot");
    expect(b[9]).toBe("brainrot");
    expect(b[0]).toBe("other");
  });

  it("sums hours per bucket (4 slots = 1 hour)", () => {
    const entries = [
      ...slots("2026-09-04", 1, 32), // 8h work
      ...slots("2026-09-04", 6, 8, 32), // 2h brainrot
      ...slots("2026-09-04", 0, 24, 40), // 6h sleep
    ];
    const t = bucketize(hoursByCategory(entries), defaultBuckets());
    expect(t).toEqual({ productive: 8, brainrot: 2, other: 6 });
    expect(productiveRatio(t)).toBe(4);
  });

  it("computes day / week / all-time windows", () => {
    // Friday 2026-09-04; Monday of that week = 2026-08-31
    expect(weekStart("2026-09-04")).toBe("2026-08-31");
    const entries = [
      ...slots("2026-08-30", 1, 8), // Sunday before -> all-time only
      ...slots("2026-09-01", 1, 8), // in week
      ...slots("2026-09-04", 1, 4), // today
    ];
    const [day, week, all] = computeRanking(entries, defaultBuckets(), "2026-09-04");
    expect(day.totals.productive).toBe(1);
    expect(week.totals.productive).toBe(3);
    expect(all.totals.productive).toBe(5);
  });

  it("ratio is null (∞) when brainrot is zero but productive > 0", () => {
    expect(productiveRatio({ productive: 5, brainrot: 0, other: 0 })).toBeNull();
    expect(productiveRatio({ productive: 0, brainrot: 0, other: 0 })).toBe(0);
  });

  it("ranking never sees labels", () => {
    const entries = slots("2026-09-04", 1, 4).map((e) => ({ ...e, label: "SECRET CLIENT" }));
    const t = bucketize(hoursByCategory(entries), defaultBuckets());
    expect(JSON.stringify(t)).not.toContain("SECRET");
  });
});
