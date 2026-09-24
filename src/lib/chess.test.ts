import { describe, it, expect } from "vitest";
import {
  coverageOf,
  filterGamesVsOpponents,
  myColour,
  normaliseCp,
  normaliseMonthlyGames,
  parseArchivesResponse,
  recentArchiveUrls,
  sortGamesNewestFirst,
  tallyMistakes,
  type ChessComGame,
} from "./chess";

function game(over: Partial<ChessComGame>): ChessComGame {
  return {
    url: "u",
    endTime: 0,
    rules: "chess",
    timeClass: "rapid",
    pgn: "1. e4 *",
    white: { username: "alice", rating: 1500, result: "win" },
    black: { username: "bob", rating: 1500, result: "loss" },
    ...over,
  };
}

describe("parseArchivesResponse", () => {
  it("returns [] when the shape is unexpected", () => {
    expect(parseArchivesResponse(null)).toEqual([]);
    expect(parseArchivesResponse({})).toEqual([]);
    expect(parseArchivesResponse({ archives: "nope" })).toEqual([]);
  });
  it("drops non-string entries", () => {
    expect(parseArchivesResponse({ archives: ["a", 1, "b"] })).toEqual(["a", "b"]);
  });
});

describe("recentArchiveUrls", () => {
  it("returns the last N (newest are at the end)", () => {
    expect(recentArchiveUrls(["1", "2", "3", "4"], 2)).toEqual(["3", "4"]);
    expect(recentArchiveUrls(["1"], 3)).toEqual(["1"]);
    expect(recentArchiveUrls([], 3)).toEqual([]);
    expect(recentArchiveUrls(["1", "2"], 0)).toEqual([]);
  });
});

describe("normaliseMonthlyGames", () => {
  it("skips games without a PGN — they cannot be analysed or shown on a board", () => {
    const out = normaliseMonthlyGames({
      games: [
        { url: "u1", pgn: "1. e4 *", end_time: 1, rules: "chess", time_class: "rapid", white: {}, black: {} },
        { url: "u2", pgn: "", end_time: 2, rules: "chess", time_class: "rapid", white: {}, black: {} },
        { url: "u3", end_time: 3, rules: "chess", time_class: "rapid", white: {}, black: {} },
      ],
    });
    expect(out.map((g) => g.url)).toEqual(["u1"]);
  });
});

describe("filterGamesVsOpponents", () => {
  it("keeps only standard chess where me + opp both match, case-insensitive", () => {
    const games = [
      game({ white: { username: "Me", rating: 1200, result: "win" } }), // opp bob
      game({ black: { username: "ME", rating: 1200, result: "loss" }, white: { username: "carol", rating: 1200, result: "win" } }),
      game({ white: { username: "me", rating: 1200, result: "win" }, black: { username: "eve", rating: 1200, result: "loss" } }),
      game({ rules: "chess960", white: { username: "me", rating: 1200, result: "win" } }),
    ];
    const out = filterGamesVsOpponents(games, "me", ["Bob", "Carol"]);
    expect(out).toHaveLength(2);
    expect(out.every((g) => g.rules === "chess")).toBe(true);
  });
});

describe("sortGamesNewestFirst", () => {
  it("sorts by endTime desc without mutating input", () => {
    const gs = [game({ url: "a", endTime: 1 }), game({ url: "b", endTime: 3 }), game({ url: "c", endTime: 2 })];
    const sorted = sortGamesNewestFirst(gs);
    expect(sorted.map((g) => g.url)).toEqual(["b", "c", "a"]);
    expect(gs.map((g) => g.url)).toEqual(["a", "b", "c"]);
  });
});

describe("tallyMistakes", () => {
  it("uses standard Lichess-style thresholds (>=200 blunder, >=100 mistake, >=50 inaccuracy)", () => {
    const t = tallyMistakes([null, 10, 60, 120, 205, 500, -50]);
    expect(t).toEqual({ blunders: 2, mistakes: 1, inaccuracies: 1 });
  });
  it("counts nothing when everything is null (fully uncovered game)", () => {
    expect(tallyMistakes([null, null, null])).toEqual({ blunders: 0, mistakes: 0, inaccuracies: 0 });
  });
});

describe("coverageOf", () => {
  it("returns the fraction of non-null plies", () => {
    expect(coverageOf([])).toBe(0);
    expect(coverageOf([null, null])).toBe(0);
    expect(coverageOf([1, null, 2, 3])).toBe(0.75);
    expect(coverageOf([1, 2])).toBe(1);
  });
});

describe("normaliseCp", () => {
  it("flips the sign to WHITE's perspective when it's black to move", () => {
    // +50 for black-to-move means black is up 50cp, i.e. -50 in WHITE terms.
    expect(normaliseCp("b", 50, null)).toBe(-50);
    expect(normaliseCp("w", 50, null)).toBe(50);
  });
  it("collapses mate to a large sentinel with the right sign", () => {
    // mate = +3 for the side to move → they mate in 3
    expect(normaliseCp("w", null, 3)).toBeGreaterThan(9000);
    expect(normaliseCp("b", null, 3)).toBeLessThan(-9000);
  });
});

describe("myColour", () => {
  it("finds me in either colour, else null", () => {
    const g = game({ white: { username: "Me", rating: 1, result: "win" }, black: { username: "bob", rating: 1, result: "loss" } });
    expect(myColour(g, "me")).toBe("white");
    expect(myColour(g, "bob")).toBe("black");
    expect(myColour(g, "not-in-game")).toBe(null);
  });
});
