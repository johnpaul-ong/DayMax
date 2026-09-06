import { afterEach, describe, expect, it, vi } from "vitest";
import { localToday, localMonth } from "../dates";

afterEach(() => vi.useRealTimers());

describe("localToday", () => {
  it("uses the LOCAL calendar, not UTC — the 00:54 Sydney bug", () => {
    // 2026-09-06T00:54 in UTC+10 is 2026-09-05T14:54 UTC.
    // toISOString().slice(0,10) would say the 5th; the user's calendar says the 6th.
    const local = new Date(2026, 8, 6, 0, 54, 0); // month is 0-indexed: 8 = September
    expect(localToday(local)).toBe("2026-09-06");
    expect(local.toISOString().slice(0, 10)).not.toBe("2026-09-06");
  });

  it("pads single-digit months and days", () => {
    expect(localToday(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("handles the last instant of a day", () => {
    expect(localToday(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31");
  });

  it("localMonth is the first seven characters", () => {
    expect(localMonth(new Date(2026, 8, 6))).toBe("2026-09");
  });
});
