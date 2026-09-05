import { describe, expect, it } from "vitest";
import { defaultBuckets } from "./categories";
import { allPairCorrelations, bucketsByPeriod, buildDayPoints, pearson } from "./stats";
import type { DayEntry } from "./types";

function slots(date: string, category: number, count: number, offset = 0): DayEntry[] {
  return Array.from({ length: count }, (_, i) => ({ date, slot: offset + i, category, label: null }));
}

describe("pearson", () => {
  it("finds perfect positive and negative correlation", () => {
    expect(pearson([[1, 2], [2, 4], [3, 6]])).toBeCloseTo(1);
    expect(pearson([[1, 6], [2, 4], [3, 2]])).toBeCloseTo(-1);
  });
  it("returns null for too few points or zero variance", () => {
    expect(pearson([[1, 1], [2, 2]])).toBeNull();
    expect(pearson([[1, 5], [2, 5], [3, 5]])).toBeNull();
  });
});

describe("bucketsByPeriod", () => {
  const entries = [
    ...slots("2026-09-01", 1, 8), // Tue, 2h work
    ...slots("2026-09-02", 1, 4), // Wed, 1h work
    ...slots("2026-09-08", 6, 4), // next Tue, 1h brainrot
  ];
  it("aggregates by week", () => {
    const weeks = bucketsByPeriod(entries, defaultBuckets(), "week");
    expect(weeks).toHaveLength(2);
    expect(weeks[0].productive).toBe(3);
    expect(weeks[0].days).toBe(2);
    expect(weeks[1].brainrot).toBe(1);
  });
  it("aggregates by month", () => {
    const months = bucketsByPeriod(entries, defaultBuckets(), "month");
    expect(months).toHaveLength(1);
    expect(months[0].productive).toBe(3);
    expect(months[0].brainrot).toBe(1);
  });
});

describe("allPairCorrelations", () => {
  it("ranks pairs by |r| and skips pairs with too few days", () => {
    // 6 days where tired goes up and productive goes down perfectly
    const points = Array.from({ length: 6 }, (_, i) => ({
      date: `2026-09-0${i + 1}`,
      productive: 10 - i,
      brainrot: null,
      sleep: null,
      emotionalScore: null,
      tired: i + 1,
      startFriction: i < 3 ? i : null, // only 3 days -> below minN
      endBrainFatigue: null,
      weightKg: null,
    }));
    const ranked = allPairCorrelations(points, 5);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].xKey).toBe("productive");
    expect(ranked[0].yKey).toBe("tired");
    expect(ranked[0].r).toBeCloseTo(-1);
    expect(ranked[0].n).toBe(6);
  });
});

describe("buildDayPoints", () => {
  it("joins slots and metrics per day and leaves gaps as null", () => {
    const pts = buildDayPoints(
      slots("2026-09-01", 1, 8),
      [{ date: "2026-09-01", emotionalScore: 7, tired: 5, startFriction: null, endBrainFatigue: null, deepTime: null, weightKg: null, notes: null }],
      defaultBuckets()
    );
    expect(pts).toHaveLength(1);
    expect(pts[0].productive).toBe(2);
    expect(pts[0].tired).toBe(5);
    expect(pts[0].weightKg).toBeNull();
  });
});
