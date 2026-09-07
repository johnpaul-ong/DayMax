import { describe, expect, it } from "vitest";
import { completionByDate, DAY_COMPLETE_SLOTS, streakMessage, summarise } from "../streaks";

/** n complete days ending on `end`, walking backwards. */
function run(end: string, n: number, slots = DAY_COMPLETE_SLOTS): Map<string, number> {
  const m = new Map<string, number>();
  const d = new Date(end + "T00:00:00");
  for (let i = 0; i < n; i++) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    m.set(iso, slots);
    d.setDate(d.getDate() - 1);
  }
  return m;
}

describe("completionByDate", () => {
  it("counts slots per day", () => {
    const m = completionByDate([{ date: "2026-09-06" }, { date: "2026-09-06" }, { date: "2026-09-05" }]);
    expect(m.get("2026-09-06")).toBe(2);
    expect(m.get("2026-09-05")).toBe(1);
  });
});

describe("summarise", () => {
  it("counts a run ending today", () => {
    const s = summarise(run("2026-09-07", 5), "2026-09-07");
    expect(s.current).toBe(5);
    expect(s.longest).toBe(5);
  });

  it("does NOT zero your streak just because today isn't finished yet", () => {
    // the important one: at 8am you've logged nothing, but yesterday's run stands
    const days = run("2026-09-06", 5); // ends yesterday
    const s = summarise(days, "2026-09-07");
    expect(s.current).toBe(5);
    expect(s.todaySlots).toBe(0);
  });

  it("breaks when a day is missed", () => {
    const days = run("2026-09-07", 3);
    days.delete("2026-09-06"); // hole in the middle
    const s = summarise(days, "2026-09-07");
    expect(s.current).toBe(1); // just today
  });

  it("counts a partial day as incomplete", () => {
    const days = new Map([["2026-09-07", DAY_COMPLETE_SLOTS - 1]]);
    const s = summarise(days, "2026-09-07");
    expect(s.current).toBe(0);
    expect(s.todaySlots).toBe(DAY_COMPLETE_SLOTS - 1);
  });

  it("finds the longest historical run even when the current one is shorter", () => {
    const days = new Map<string, number>();
    for (const d of ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"]) days.set(d, 96);
    for (const d of ["2026-09-06", "2026-09-07"]) days.set(d, 96);
    const s = summarise(days, "2026-09-07");
    expect(s.current).toBe(2);
    expect(s.longest).toBe(4);
  });

  it("reports last7 and last30 windows", () => {
    const s = summarise(run("2026-09-07", 10), "2026-09-07");
    expect(s.last7).toBe(7);
    expect(s.last30).toBe(10);
  });

  it("handles an empty history without throwing", () => {
    const s = summarise(new Map(), "2026-09-07");
    expect(s).toMatchObject({ current: 0, longest: 0, last7: 0, last30: 0, todaySlots: 0, todayPercent: 0 });
  });

  it("computes today's percentage of 96 slots", () => {
    const s = summarise(new Map([["2026-09-07", 48]]), "2026-09-07");
    expect(s.todayPercent).toBe(50);
  });
});

describe("streakMessage", () => {
  it("tells you exactly what today still needs", () => {
    const s = summarise(run("2026-09-06", 4), "2026-09-07");
    expect(streakMessage(s)).toContain(`${DAY_COMPLETE_SLOTS} more slots`.replace(`${DAY_COMPLETE_SLOTS}`, `${DAY_COMPLETE_SLOTS}`));
    expect(streakMessage(s)).toContain("4-day streak");
  });

  it("is silent when there is nothing to say", () => {
    expect(streakMessage(summarise(new Map(), "2026-09-07"))).toBeNull();
  });
});
