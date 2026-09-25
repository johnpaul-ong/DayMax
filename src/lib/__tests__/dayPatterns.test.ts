import { describe, expect, it } from "vitest";
import { dayPatterns, type SlotRow } from "../dayPatterns";

/** A day from a list of [fromHour, toHour, category] blocks; unlisted hours are unlogged. */
function day(date: string, blocks: [number, number, number][]): SlotRow[] {
  const rows: SlotRow[] = [];
  for (const [from, to, category] of blocks) {
    for (let s = from * 4; s < to * 4; s++) rows.push({ date, slot: s, category });
  }
  return rows;
}

// sleep 0-7, eat 7-8, work 9-11, travel 11-12, work 13-15, then a choppy
// 16-18 (social/other alternating every 15 min), social 19-21, leisure 21-23, sleep 23-24
function typical(date: string): SlotRow[] {
  const rows = day(date, [
    [0, 7, 0], [7, 9, 7], [9, 11, 1], [11, 13, 4], [13, 15, 1], [15, 16, 5],
    [19, 21, 3], [21, 23, 9], [23, 24, 0],
  ]);
  for (let s = 64; s < 76; s++) rows.push({ date, slot: s, category: s % 2 === 0 ? 3 : 6 });
  return rows;
}

const threeDays = [...typical("2026-09-21"), ...typical("2026-09-22"), ...typical("2026-09-23")];

describe("dayPatterns", () => {
  it("says nothing with fewer than three well-logged days", () => {
    expect(dayPatterns([...typical("2026-09-21"), ...typical("2026-09-22")])).toEqual([]);
    // a third day with only two hours logged does not count
    expect(dayPatterns([...typical("2026-09-21"), ...typical("2026-09-22"), ...day("2026-09-23", [[9, 11, 1]])])).toEqual([]);
  });

  it("finds the most productive two-hour window", () => {
    const p = dayPatterns(threeDays).find((x) => x.kind === "peak_productive");
    expect(p?.text).toContain("9am–11am");
    expect(p?.text).toContain("2h of work or sport");
  });

  it("reports the longest unbroken productive block", () => {
    expect(dayPatterns(threeDays).find((x) => x.kind === "focus_block")?.text).toContain("2h");
  });

  it("finds where you switch activities most, ignoring sleep", () => {
    const p = dayPatterns(threeDays).find((x) => x.kind === "switching");
    expect(p?.text).toMatch(/around 4pm–6pm/);
  });

  it("finds the social and brainrot peaks", () => {
    const ps = dayPatterns(threeDays);
    expect(ps.find((x) => x.kind === "social")?.text).toContain("7pm–9pm");
    expect(ps.find((x) => x.kind === "brainrot")?.text).toContain("9pm–11pm");
  });

  it("reads a typical wake time from days that start asleep", () => {
    expect(dayPatterns(threeDays).find((x) => x.kind === "wake")?.text).toContain("7am");
  });

  it("stays quiet about social time when there is almost none", () => {
    const quiet = ["2026-09-21", "2026-09-22", "2026-09-23"].flatMap((d) =>
      day(d, [[0, 7, 0], [7, 23, 1], [23, 24, 0]]),
    );
    const ps = dayPatterns(quiet);
    expect(ps.find((x) => x.kind === "social")).toBeUndefined();
    expect(ps.find((x) => x.kind === "switching")).toBeUndefined();
  });
});
