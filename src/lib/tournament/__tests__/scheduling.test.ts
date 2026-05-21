import { describe, it, expect } from "vitest";
import { balancedRoundRobin, generateAllPairMatches } from "../scheduling";

// ---------------------------------------------------------------------------
// balancedRoundRobin
// ---------------------------------------------------------------------------
describe("balancedRoundRobin", () => {
  it("returns empty array for sizeA=0", () => {
    expect(balancedRoundRobin(0, 4)).toEqual([]);
  });

  it("returns empty array for sizeB=0", () => {
    expect(balancedRoundRobin(4, 0)).toEqual([]);
  });

  it("returns empty array for 0x0", () => {
    expect(balancedRoundRobin(0, 0)).toEqual([]);
  });

  it("1v1 produces exactly 1 match", () => {
    const result = balancedRoundRobin(1, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual([0, 0]);
  });

  it("2v2 produces exactly 4 matches, all unique pairs", () => {
    const result = balancedRoundRobin(2, 2);
    expect(result).toHaveLength(4);
    const keys = result.map(([a, b]) => `${a}-${b}`);
    expect(new Set(keys).size).toBe(4);
  });

  it("4v4 produces 16 matches, all unique (a,b) pairs", () => {
    const result = balancedRoundRobin(4, 4);
    expect(result).toHaveLength(16);
    const keys = result.map(([a, b]) => `${a}-${b}`);
    expect(new Set(keys).size).toBe(16);
    // All sideA indices 0-3 present
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        expect(keys).toContain(`${a}-${b}`);
      }
    }
  });

  it("3v5 produces 15 matches, all unique", () => {
    const result = balancedRoundRobin(3, 5);
    expect(result).toHaveLength(15);
    const keys = result.map(([a, b]) => `${a}-${b}`);
    expect(new Set(keys).size).toBe(15);
  });

  it("5v3 produces 15 matches (sizeA > sizeB)", () => {
    const result = balancedRoundRobin(5, 3);
    expect(result).toHaveLength(15);
    const keys = result.map(([a, b]) => `${a}-${b}`);
    expect(new Set(keys).size).toBe(15);
  });

  it("1v5 produces 5 matches", () => {
    const result = balancedRoundRobin(1, 5);
    expect(result).toHaveLength(5);
    const keys = result.map(([a, b]) => `${a}-${b}`);
    expect(new Set(keys).size).toBe(5);
  });

  it("all sideA indices are within bounds [0, sizeA)", () => {
    const result = balancedRoundRobin(3, 4);
    result.forEach(([a]) => {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(3);
    });
  });

  it("all sideB indices are within bounds [0, sizeB)", () => {
    const result = balancedRoundRobin(3, 4);
    result.forEach(([, b]) => {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(4);
    });
  });

  it("negative sizeA returns empty", () => {
    expect(balancedRoundRobin(-1, 3)).toEqual([]);
  });

  it("negative sizeB returns empty", () => {
    expect(balancedRoundRobin(3, -1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// generateAllPairMatches
// ---------------------------------------------------------------------------
describe("generateAllPairMatches", () => {
  it("returns empty for zero teams", () => {
    expect(generateAllPairMatches([])).toEqual([]);
  });

  it("returns empty for single team (no cross-team matches)", () => {
    expect(generateAllPairMatches([{ teamId: "T1", pairIds: ["p1", "p2"] }])).toEqual([]);
  });

  it("2 teams x 1 pair each → 1 match", () => {
    const result = generateAllPairMatches([
      { teamId: "T1", pairIds: ["p1"] },
      { teamId: "T2", pairIds: ["p2"] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ teamAId: "T1", teamBId: "T2", pairAId: "p1", pairBId: "p2" });
  });

  it("2 teams x 2 pairs each → 4 matches", () => {
    const result = generateAllPairMatches([
      { teamId: "T1", pairIds: ["p1a", "p1b"] },
      { teamId: "T2", pairIds: ["p2a", "p2b"] },
    ]);
    expect(result).toHaveLength(4);
    // All must have T1 vs T2
    result.forEach((m) => {
      expect(m.teamAId).toBe("T1");
      expect(m.teamBId).toBe("T2");
    });
    const pairKeys = result.map((m) => `${m.pairAId}-${m.pairBId}`);
    expect(new Set(pairKeys).size).toBe(4);
  });

  it("3 teams x 2 pairs each → 12 matches (3 team-pairings x 4 pair-matchups)", () => {
    const result = generateAllPairMatches([
      { teamId: "T1", pairIds: ["p1a", "p1b"] },
      { teamId: "T2", pairIds: ["p2a", "p2b"] },
      { teamId: "T3", pairIds: ["p3a", "p3b"] },
    ]);
    expect(result).toHaveLength(12);
  });

  it("output fields: teamAId < teamBId ordering follows input order", () => {
    const result = generateAllPairMatches([
      { teamId: "T1", pairIds: ["p1"] },
      { teamId: "T2", pairIds: ["p2"] },
    ]);
    expect(result[0].teamAId).toBe("T1");
    expect(result[0].teamBId).toBe("T2");
  });

  it("uses correct pairIds for each team", () => {
    const result = generateAllPairMatches([
      { teamId: "T1", pairIds: ["alpha"] },
      { teamId: "T2", pairIds: ["beta"] },
    ]);
    expect(result[0].pairAId).toBe("alpha");
    expect(result[0].pairBId).toBe("beta");
  });

  it("no same-team matches generated", () => {
    const result = generateAllPairMatches([
      { teamId: "T1", pairIds: ["p1a", "p1b"] },
      { teamId: "T2", pairIds: ["p2a", "p2b"] },
      { teamId: "T3", pairIds: ["p3a", "p3b"] },
    ]);
    result.forEach((m) => {
      expect(m.teamAId).not.toBe(m.teamBId);
    });
  });
});
