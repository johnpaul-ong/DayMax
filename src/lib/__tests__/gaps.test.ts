import { describe, expect, it } from "vitest";
import { dateRange, findGaps, summarise, toRuns } from "../gaps";

const day = (date: string, n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ date, slot: i + offset }));

describe("toRuns", () => {
  it("collapses contiguous slots", () => {
    expect(toRuns([0, 1, 2, 5, 6, 9])).toEqual([[0, 2], [5, 6], [9, 9]]);
  });

  it("handles empty and single", () => {
    expect(toRuns([])).toEqual([]);
    expect(toRuns([42])).toEqual([[42, 42]]);
  });

  it("does not care about input order", () => {
    expect(toRuns([9, 1, 0, 2])).toEqual([[0, 2], [9, 9]]);
  });
});

describe("dateRange", () => {
  it("crosses a month boundary", () => {
    expect(dateRange("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  it("does not drop or duplicate a day when the clocks change", () => {
    // Sydney leaves DST on the first Sunday in April. Adding 24h in UTC here
    // would produce 2026-04-05 twice; setDate() keeps it honest.
    expect(dateRange("2026-04-04", "2026-04-06")).toEqual(["2026-04-04", "2026-04-05", "2026-04-06"]);
  });

  it("is inclusive of a single day", () => {
    expect(dateRange("2026-01-01", "2026-01-01")).toEqual(["2026-01-01"]);
  });
});

describe("findGaps", () => {
  it("reports a day that is 90/96 as missing 6 slots", () => {
    const gaps = findGaps(day("2026-01-01", 90), "2026-01-01", "2026-01-01");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ filled: 90, missing: 6 });
    expect(gaps[0].runs).toEqual([[90, 95]]);
  });

  it("counts a day with nothing logged as fully missing", () => {
    const gaps = findGaps([], "2026-01-01", "2026-01-01");
    expect(gaps[0]).toMatchObject({ filled: 0, missing: 96 });
  });

  it("omits complete days", () => {
    expect(findGaps(day("2026-01-01", 96), "2026-01-01", "2026-01-01")).toEqual([]);
  });

  it("respects minMissing", () => {
    const entries = day("2026-01-01", 95); // 1 slot short
    expect(findGaps(entries, "2026-01-01", "2026-01-01", 1)).toHaveLength(1);
    expect(findGaps(entries, "2026-01-01", "2026-01-01", 4)).toHaveLength(0);
  });

  it("ignores entries outside the range", () => {
    const entries = [...day("2025-12-31", 96), ...day("2026-01-01", 96)];
    expect(findGaps(entries, "2026-01-01", "2026-01-01")).toEqual([]);
  });

  it("sorts worst first, then by date", () => {
    const entries = [...day("2026-01-01", 10), ...day("2026-01-02", 50), ...day("2026-01-03", 10)];
    expect(findGaps(entries, "2026-01-01", "2026-01-03").map((g) => g.date)).toEqual([
      "2026-01-01",
      "2026-01-03",
      "2026-01-02",
    ]);
  });

  it("finds a hole in the middle of a day, not just the tail", () => {
    const entries = [...day("2026-01-01", 40), ...day("2026-01-01", 40, 56)];
    const [gap] = findGaps(entries, "2026-01-01", "2026-01-01");
    expect(gap.runs).toEqual([[40, 55]]);
  });
});

describe("summarise", () => {
  it("explains the 23.1h-not-24h gap", () => {
    // two days at 90/96 = 22.5h each. The missing 1.5h/day is the whole point.
    const entries = [...day("2026-01-01", 90), ...day("2026-01-02", 90)];
    const s = summarise(entries, "2026-01-01", "2026-01-02");
    expect(s.averageLoggedHours).toBe(22.5);
    expect(s.loggedHours).toBe(45);
    expect(s.missingHours).toBe(3);
    // logged + missing must always be exactly 24h per day in range
    expect(s.loggedHours + s.missingHours).toBe(2 * 24);
    expect(s.incompleteDays).toBe(2);
    expect(s.completeDays).toBe(0);
    expect(s.emptyDays).toBe(0);
  });

  it("counts fully blank days separately", () => {
    const s = summarise(day("2026-01-01", 96), "2026-01-01", "2026-01-03");
    expect(s.completeDays).toBe(1);
    expect(s.emptyDays).toBe(2);
    expect(s.missingHours).toBe(48);
  });

  it("names the worst month", () => {
    const entries = [...day("2026-01-01", 96), ...day("2026-02-01", 96), ...day("2026-02-02", 96)];
    // Jan has 30 blank days, Feb has 26 — January is worse
    expect(summarise(entries, "2026-01-01", "2026-02-28").worstMonth).toBe("2026-01");
  });
});
