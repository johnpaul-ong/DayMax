import { describe, expect, it } from "vitest";
import {
  buildQueue,
  guessCategory,
  inQuietHours,
  learnLabels,
  normalizeLabel,
  slotForTime,
  suggestLabels,
} from "../capture";

describe("slotForTime", () => {
  it("maps wall-clock time to a 15-minute slot", () => {
    expect(slotForTime(new Date(2026, 8, 6, 0, 0))).toBe(0);
    expect(slotForTime(new Date(2026, 8, 6, 0, 14))).toBe(0);
    expect(slotForTime(new Date(2026, 8, 6, 0, 15))).toBe(1);
    expect(slotForTime(new Date(2026, 8, 6, 9, 30))).toBe(38);
    expect(slotForTime(new Date(2026, 8, 6, 23, 59))).toBe(95);
  });
});

describe("inQuietHours", () => {
  it("handles a window that wraps midnight", () => {
    // the default: 22:00 -> 07:00
    expect(inQuietHours(23, 22, 7)).toBe(true);
    expect(inQuietHours(3, 22, 7)).toBe(true);
    expect(inQuietHours(6, 22, 7)).toBe(true);
    expect(inQuietHours(7, 22, 7)).toBe(false);
    expect(inQuietHours(14, 22, 7)).toBe(false);
  });

  it("handles a window inside one day", () => {
    expect(inQuietHours(10, 9, 12)).toBe(true);
    expect(inQuietHours(12, 9, 12)).toBe(false);
  });

  it("treats from === to as never quiet", () => {
    expect(inQuietHours(5, 0, 0)).toBe(false);
  });
});

describe("buildQueue", () => {
  const base = { lookbackSlots: 8, maxQueue: 8 };

  it("never asks about the slot currently in progress", () => {
    const q = buildQueue({ ...base, filledSlots: new Set(), nowSlot: 40 });
    expect(q).not.toContain(40);
    expect(Math.max(...q)).toBe(39);
  });

  it("skips slots already logged", () => {
    const q = buildQueue({ ...base, filledSlots: new Set([36, 37]), nowSlot: 40 });
    expect(q).toEqual([32, 33, 34, 35, 38, 39]);
  });

  it("respects the lookback so opening the app at 5pm doesn't ask about breakfast", () => {
    const q = buildQueue({ ...base, filledSlots: new Set(), nowSlot: 68, lookbackSlots: 4 });
    expect(q).toEqual([64, 65, 66, 67]);
  });

  it("keeps the MOST RECENT slots when there's a backlog", () => {
    // you can remember the last hour; you cannot remember 9am
    const q = buildQueue({ filledSlots: new Set(), nowSlot: 60, lookbackSlots: 40, maxQueue: 4 });
    expect(q).toEqual([56, 57, 58, 59]);
  });

  it("honours skipped slots so 'Skip' doesn't loop forever", () => {
    const q = buildQueue({ ...base, filledSlots: new Set(), nowSlot: 36, skipped: new Set([34, 35]) });
    expect(q).not.toContain(34);
    expect(q).not.toContain(35);
  });

  it("is empty when everything is filled", () => {
    const all = new Set(Array.from({ length: 96 }, (_, i) => i));
    expect(buildQueue({ ...base, filledSlots: all, nowSlot: 50 })).toEqual([]);
  });

  it("does not go below slot 0 early in the morning", () => {
    const q = buildQueue({ ...base, filledSlots: new Set(), nowSlot: 3, lookbackSlots: 8 });
    expect(q).toEqual([0, 1, 2]);
  });
});

describe("label memory", () => {
  const history = [
    { category: 1, label: "email" },
    { category: 1, label: "Email" },
    { category: 1, label: "deep work" },
    { category: 2, label: "gym" },
    { category: 9, label: "youtube" },
    { category: 1, label: "email" },
    { category: 6, label: "youtube" }, // ambiguous on purpose
  ];

  it("normalizes case and whitespace", () => {
    expect(normalizeLabel("  Deep   Work ")).toBe("deep work");
  });

  it("learns the category you usually pair a label with", () => {
    const mem = learnLabels(history);
    expect(guessCategory("email", mem)).toBe(1);
    expect(guessCategory("EMAIL", mem)).toBe(1);
    expect(guessCategory("gym", mem)).toBe(2);
  });

  it("picks the majority category when a label is used inconsistently", () => {
    // youtube: once as 9, once as 6 — first wins the tie, but it must be one of them
    const mem = learnLabels(history);
    expect([6, 9]).toContain(guessCategory("youtube", mem));
  });

  it("resolves an unambiguous prefix", () => {
    const mem = learnLabels(history);
    expect(guessCategory("deep", mem)).toBe(1); // only "deep work" matches
  });

  it("returns null rather than guessing on an ambiguous prefix", () => {
    // "e" would match "email" (1) only here, so use a genuinely split prefix
    const mem = learnLabels([
      { category: 1, label: "planning" },
      { category: 3, label: "party" },
    ]);
    expect(guessCategory("p", mem)).toBeNull();
  });

  it("returns null for something never seen", () => {
    const mem = learnLabels(history);
    expect(guessCategory("scuba diving", mem)).toBeNull();
    expect(guessCategory("", mem)).toBeNull();
  });

  it("ignores entries with no label", () => {
    const mem = learnLabels([{ category: 1, label: null }, { category: 1, label: "  " }]);
    expect(mem.suggestions).toHaveLength(0);
  });

  it("orders suggestions by how often you use them", () => {
    const mem = learnLabels(history);
    expect(mem.suggestions[0].label.toLowerCase()).toBe("email"); // 3 uses
  });

  it("suggests by substring, not just prefix", () => {
    const mem = learnLabels(history);
    expect(suggestLabels("work", mem).map((s) => s.label)).toContain("deep work");
  });
});
