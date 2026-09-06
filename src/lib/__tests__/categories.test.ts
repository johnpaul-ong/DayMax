import { describe, expect, it } from "vitest";
import { CATEGORIES, defaultBuckets, HOURS_PER_SLOT, slotToTime, SLOTS_PER_DAY } from "../categories";

describe("slots", () => {
  it("covers exactly 24 hours", () => {
    expect(SLOTS_PER_DAY * HOURS_PER_SLOT).toBe(24);
  });

  it("maps slot indices to wall-clock time", () => {
    expect(slotToTime(0)).toBe("00:00");
    expect(slotToTime(1)).toBe("00:15");
    expect(slotToTime(48)).toBe("12:00");
    expect(slotToTime(95)).toBe("23:45");
  });
});

describe("categories", () => {
  it("has exactly 10, numbered 0-9 with no gaps", () => {
    expect(CATEGORIES).toHaveLength(10);
    expect(CATEGORIES.map((c) => c.code).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("gives every category a default bucket", () => {
    const b = defaultBuckets();
    for (const c of CATEGORIES) expect(b[c.code]).toBeDefined();
  });
});
