import { describe, it, expect } from "vitest";
import {
  computePairDivision,
  divisionCount,
  divisionTone,
  parseDivision,
  parsePairLevel,
  parseTournamentThresholds,
  buildPairDivisionMap,
  DIVISION_COLORS,
} from "../divisions";

// ---------------------------------------------------------------------------
// divisionCount
// ---------------------------------------------------------------------------
describe("divisionCount", () => {
  it("empty thresholds → 1 division", () => expect(divisionCount([])).toBe(1));
  it("1 threshold → 2 divisions", () => expect(divisionCount([5])).toBe(2));
  it("2 thresholds → 3 divisions", () => expect(divisionCount([3, 6])).toBe(3));
  it("3 thresholds → 4 divisions", () => expect(divisionCount([3, 6, 9])).toBe(4));
});

// ---------------------------------------------------------------------------
// computePairDivision — empty thresholds
// ---------------------------------------------------------------------------
describe("computePairDivision empty thresholds", () => {
  it("returns null for any level when thresholds=[]", () => {
    expect(computePairDivision(10, [])).toBeNull();
    expect(computePairDivision(0, [])).toBeNull();
    expect(computePairDivision(null, [])).toBeNull();
    expect(computePairDivision(undefined, [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computePairDivision — 1 threshold [5] → 2 divisions
//   Division 1 (top): pair_level > 5
//   Division 2 (bot): pair_level <= 5
// ---------------------------------------------------------------------------
describe("computePairDivision 1 threshold [5]", () => {
  const T = [5];

  it("level 6 (above threshold) → Division 1", () => {
    expect(computePairDivision(6, T)).toBe(1);
  });

  it("level 5 (at threshold) → Division 2 (NOT > threshold)", () => {
    expect(computePairDivision(5, T)).toBe(2);
  });

  it("level 4 (below threshold) → Division 2", () => {
    expect(computePairDivision(4, T)).toBe(2);
  });

  it("level 0 → Division 2", () => {
    expect(computePairDivision(0, T)).toBe(2);
  });

  it("very high level → Division 1", () => {
    expect(computePairDivision(100, T)).toBe(1);
  });

  it("null level → treated as 0 → Division 2", () => {
    expect(computePairDivision(null, T)).toBe(2);
  });

  it("undefined level → treated as 0 → Division 2", () => {
    expect(computePairDivision(undefined, T)).toBe(2);
  });

  it("decimal level just above threshold (5.1) → Division 1", () => {
    expect(computePairDivision(5.1, T)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computePairDivision — 2 thresholds [3, 6] → 3 divisions
//   Division 1 (top): pair_level > 6
//   Division 2 (mid): 3 < pair_level <= 6
//   Division 3 (bot): pair_level <= 3
// ---------------------------------------------------------------------------
describe("computePairDivision 2 thresholds [3, 6]", () => {
  const T = [3, 6];

  it("level 7 → Division 1", () => expect(computePairDivision(7, T)).toBe(1));
  it("level 6 → Division 2 (not > 6)", () => expect(computePairDivision(6, T)).toBe(2));
  it("level 5 (between 3 and 6) → Division 2", () => expect(computePairDivision(5, T)).toBe(2));
  it("level 3.1 (just above 3) → Division 2", () => expect(computePairDivision(3.1, T)).toBe(2));
  it("level 3 (at lower threshold) → Division 3", () => expect(computePairDivision(3, T)).toBe(3));
  it("level 2 (below all) → Division 3", () => expect(computePairDivision(2, T)).toBe(3));
  it("level 0 → Division 3", () => expect(computePairDivision(0, T)).toBe(3));
  it("null level → 0 → Division 3", () => expect(computePairDivision(null, T)).toBe(3));
  it("exactly 6.0 → Division 2 (not > 6)", () => expect(computePairDivision(6.0, T)).toBe(2));
  it("level 6.01 → Division 1", () => expect(computePairDivision(6.01, T)).toBe(1));
});

// ---------------------------------------------------------------------------
// computePairDivision — 3 thresholds [2, 5, 8] → 4 divisions
// ---------------------------------------------------------------------------
describe("computePairDivision 3 thresholds [2, 5, 8]", () => {
  const T = [2, 5, 8];

  it("level 9 → Division 1", () => expect(computePairDivision(9, T)).toBe(1));
  it("level 8 → Division 2 (not > 8)", () => expect(computePairDivision(8, T)).toBe(2));
  it("level 7 → Division 2", () => expect(computePairDivision(7, T)).toBe(2));
  it("level 5 → Division 3", () => expect(computePairDivision(5, T)).toBe(3));
  it("level 4 → Division 3", () => expect(computePairDivision(4, T)).toBe(3));
  it("level 2 → Division 4", () => expect(computePairDivision(2, T)).toBe(4));
  it("level 1 → Division 4", () => expect(computePairDivision(1, T)).toBe(4));
});

// ---------------------------------------------------------------------------
// divisionTone — cycles 8-color palette
// ---------------------------------------------------------------------------
describe("divisionTone", () => {
  it("n=1 returns DIVISION_COLORS[0]", () => {
    expect(divisionTone(1)).toEqual(DIVISION_COLORS[0]);
  });

  it("n=8 returns DIVISION_COLORS[7]", () => {
    expect(divisionTone(8)).toEqual(DIVISION_COLORS[7]);
  });

  it("n=9 wraps around and returns DIVISION_COLORS[0]", () => {
    expect(divisionTone(9)).toEqual(DIVISION_COLORS[0]);
  });

  it("n=10 wraps to DIVISION_COLORS[1]", () => {
    expect(divisionTone(10)).toEqual(DIVISION_COLORS[1]);
  });

  it("cycle: n and n+8 return the same color", () => {
    for (let i = 1; i <= 8; i++) {
      expect(divisionTone(i)).toEqual(divisionTone(i + 8));
    }
  });

  it("all returned objects have border, bg, text keys", () => {
    for (let i = 1; i <= 16; i++) {
      const tone = divisionTone(i);
      expect(tone).toHaveProperty("border");
      expect(tone).toHaveProperty("bg");
      expect(tone).toHaveProperty("text");
    }
  });
});

// ---------------------------------------------------------------------------
// parseDivision
// ---------------------------------------------------------------------------
describe("parseDivision", () => {
  it("parses '1' → 1", () => expect(parseDivision("1")).toBe(1));
  it("parses '2' → 2", () => expect(parseDivision("2")).toBe(2));
  it("null → null", () => expect(parseDivision(null)).toBeNull());
  it("undefined → null", () => expect(parseDivision(undefined)).toBeNull());
  it("empty string → null", () => expect(parseDivision("")).toBeNull());
  it("'abc' → null (non-numeric)", () => expect(parseDivision("abc")).toBeNull());
  it("'0' → null (not > 0)", () => expect(parseDivision("0")).toBeNull());
  it("'-1' → null (not > 0)", () => expect(parseDivision("-1")).toBeNull());
});

// ---------------------------------------------------------------------------
// parsePairLevel
// ---------------------------------------------------------------------------
describe("parsePairLevel", () => {
  it("'3' → 3", () => expect(parsePairLevel("3")).toBe(3));
  it("'3.5' → 3.5", () => expect(parsePairLevel("3.5")).toBe(3.5));
  it("null → null", () => expect(parsePairLevel(null)).toBeNull());
  it("undefined → null", () => expect(parsePairLevel(undefined)).toBeNull());
  it("'abc' → null", () => expect(parsePairLevel("abc")).toBeNull());
  it("'0' → 0", () => expect(parsePairLevel("0")).toBe(0));
});

// ---------------------------------------------------------------------------
// parseTournamentThresholds
// ---------------------------------------------------------------------------
describe("parseTournamentThresholds", () => {
  it("returns filtered numbers from array", () => {
    expect(parseTournamentThresholds([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("filters out non-numeric values", () => {
    expect(parseTournamentThresholds([1, "x", null, 3])).toEqual([1, 3]);
  });

  it("null → empty array", () => expect(parseTournamentThresholds(null)).toEqual([]));
  it("undefined → empty array", () => expect(parseTournamentThresholds(undefined)).toEqual([]));
  it("non-array (object) → empty array", () => expect(parseTournamentThresholds({})).toEqual([]));
  it("filters out Infinity", () => {
    expect(parseTournamentThresholds([1, Infinity, 3])).toEqual([1, 3]);
  });
  it("filters out NaN", () => {
    expect(parseTournamentThresholds([1, NaN, 3])).toEqual([1, 3]);
  });
});

// ---------------------------------------------------------------------------
// buildPairDivisionMap
// ---------------------------------------------------------------------------
describe("buildPairDivisionMap", () => {
  it("returns empty map when thresholds=[]", () => {
    const result = buildPairDivisionMap([{ id: "p1", pair_level: "5" }], []);
    expect(result.size).toBe(0);
  });

  it("maps pairs correctly with 1 threshold [5]", () => {
    const pairs = [
      { id: "p1", pair_level: "6" },
      { id: "p2", pair_level: "4" },
    ];
    const result = buildPairDivisionMap(pairs, [5]);
    expect(result.get("p1")).toBe(1);
    expect(result.get("p2")).toBe(2);
  });

  it("handles null pair_level (treated as 0 → bottom division)", () => {
    const pairs = [{ id: "p1", pair_level: null }];
    const result = buildPairDivisionMap(pairs, [5]);
    expect(result.get("p1")).toBe(2);
  });
});
