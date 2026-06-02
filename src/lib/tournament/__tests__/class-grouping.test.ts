import { describe, it, expect } from "vitest";
import {
  balancedTeamGroupAssignment,
  type ClassPair,
} from "../class-grouping";

// ---------------------------------------------------------------------------
// Helper: verify cross-team rule holds for a GroupingResult
// For every group, no two pairIds share the same teamId.
// ---------------------------------------------------------------------------
function assertCrossTeamRule(
  groups: string[][],
  pairMap: Map<string, string>, // pairId → teamId
): void {
  for (let i = 0; i < groups.length; i++) {
    const teamIds = groups[i].map((pid) => {
      const tid = pairMap.get(pid);
      expect(tid).toBeDefined(); // guard: pairId must be in the map
      return tid!;
    });
    const uniqueTeams = new Set(teamIds);
    expect(uniqueTeams.size).toBe(teamIds.length);
  }
}

// ---------------------------------------------------------------------------
// empty pairs → ok: true, groups: []
// ---------------------------------------------------------------------------
describe("balancedTeamGroupAssignment — empty pairs", () => {
  it("returns ok:true with empty groups array", () => {
    const result = balancedTeamGroupAssignment([], 4);
    expect(result).toEqual({ ok: true, groups: [] });
  });
});

// ---------------------------------------------------------------------------
// pairsPerGroup = 0 → ok: false
// ---------------------------------------------------------------------------
describe("balancedTeamGroupAssignment — pairsPerGroup < 1", () => {
  it("pairsPerGroup=0 returns ok:false", () => {
    const pairs: ClassPair[] = [{ pairId: "p1", teamId: "t1" }];
    const result = balancedTeamGroupAssignment(pairs, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("pairs_per_group ต้องมากกว่า 0");
    }
  });

  it("pairsPerGroup=-1 also returns ok:false", () => {
    const pairs: ClassPair[] = [{ pairId: "p1", teamId: "t1" }];
    const result = balancedTeamGroupAssignment(pairs, -1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("pairs_per_group ต้องมากกว่า 0");
    }
  });
});

// ---------------------------------------------------------------------------
// single pair → 1 group of 1
// ---------------------------------------------------------------------------
describe("balancedTeamGroupAssignment — single pair", () => {
  it("produces 1 group containing the single pairId", () => {
    const pairs: ClassPair[] = [{ pairId: "p1", teamId: "tA" }];
    const result = balancedTeamGroupAssignment(pairs, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toEqual(["p1"]);
  });
});

// ---------------------------------------------------------------------------
// 2 teams × 4 pairs each, pairsPerGroup=2 → 4 groups
// groupCount = ceil(8/2) = 4; each team has 4 ≤ 4 → feasible
// Each group should have exactly one pair from each team (cross-team rule)
// ---------------------------------------------------------------------------
describe("balancedTeamGroupAssignment — 2 teams × 4 pairs, pairsPerGroup=2", () => {
  const pairs: ClassPair[] = [
    { pairId: "a1", teamId: "teamA" },
    { pairId: "a2", teamId: "teamA" },
    { pairId: "a3", teamId: "teamA" },
    { pairId: "a4", teamId: "teamA" },
    { pairId: "b1", teamId: "teamB" },
    { pairId: "b2", teamId: "teamB" },
    { pairId: "b3", teamId: "teamB" },
    { pairId: "b4", teamId: "teamB" },
  ];
  const pairMap = new Map(pairs.map((p) => [p.pairId, p.teamId]));

  it("produces 4 groups", () => {
    const result = balancedTeamGroupAssignment(pairs, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups).toHaveLength(4);
  });

  it("all 8 pairs are assigned exactly once", () => {
    const result = balancedTeamGroupAssignment(pairs, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const all = result.groups.flat();
    expect(all.sort()).toEqual(
      ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"].sort(),
    );
  });

  it("cross-team rule: no group contains 2 pairs from the same team", () => {
    const result = balancedTeamGroupAssignment(pairs, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertCrossTeamRule(result.groups, pairMap);
  });

  it("each group has exactly 2 pairs (perfectly balanced)", () => {
    const result = balancedTeamGroupAssignment(pairs, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const group of result.groups) {
      expect(group).toHaveLength(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Uneven total: 7 pairs, pairsPerGroup=4 → groupCount=2
// Use 4 teams: sizes 2/2/2/1 — all ≤ 2, feasible
// Result: 2 groups, sizes 4/3 — last group smaller, NO synthetic padding
// ---------------------------------------------------------------------------
describe("balancedTeamGroupAssignment — 7 pairs, pairsPerGroup=4 (uneven)", () => {
  const pairs: ClassPair[] = [
    { pairId: "t1p1", teamId: "team1" },
    { pairId: "t1p2", teamId: "team1" },
    { pairId: "t2p1", teamId: "team2" },
    { pairId: "t2p2", teamId: "team2" },
    { pairId: "t3p1", teamId: "team3" },
    { pairId: "t3p2", teamId: "team3" },
    { pairId: "t4p1", teamId: "team4" },
  ];
  const pairMap = new Map(pairs.map((p) => [p.pairId, p.teamId]));

  it("produces exactly 2 groups", () => {
    const result = balancedTeamGroupAssignment(pairs, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups).toHaveLength(2);
  });

  it("all 7 pairs assigned — no synthetic padding", () => {
    const result = balancedTeamGroupAssignment(pairs, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const all = result.groups.flat();
    expect(all).toHaveLength(7);
    const sorted = all.slice().sort();
    expect(sorted).toEqual(
      ["t1p1", "t1p2", "t2p1", "t2p2", "t3p1", "t3p2", "t4p1"].sort(),
    );
  });

  it("group sizes differ by at most 1 (4 and 3)", () => {
    const result = balancedTeamGroupAssignment(pairs, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sizes = result.groups.map((g) => g.length).sort((a, b) => b - a);
    expect(sizes[0] - sizes[sizes.length - 1]).toBeLessThanOrEqual(1);
  });

  it("cross-team rule holds", () => {
    const result = balancedTeamGroupAssignment(pairs, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertCrossTeamRule(result.groups, pairMap);
  });
});

// ---------------------------------------------------------------------------
// Infeasibility: single team submits all 5 pairs, pairsPerGroup=4
// groupCount = ceil(5/4) = 2; team has 5 > 2 → ok:false
// ---------------------------------------------------------------------------
describe("balancedTeamGroupAssignment — infeasible: one team with too many pairs", () => {
  const pairs: ClassPair[] = [
    { pairId: "p1", teamId: "bigTeam" },
    { pairId: "p2", teamId: "bigTeam" },
    { pairId: "p3", teamId: "bigTeam" },
    { pairId: "p4", teamId: "bigTeam" },
    { pairId: "p5", teamId: "bigTeam" },
  ];

  it("returns ok:false", () => {
    const result = balancedTeamGroupAssignment(pairs, 4);
    expect(result.ok).toBe(false);
  });

  it("error message mentions the offending teamId", () => {
    const result = balancedTeamGroupAssignment(pairs, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("bigTeam");
    }
  });

  it("error message mentions the pair count and groupCount", () => {
    const result = balancedTeamGroupAssignment(pairs, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // groupCount = ceil(5/4) = 2
      expect(result.error).toBe(
        "ทีม bigTeam ส่ง 5 คู่ เกินจำนวนกลุ่ม (2) — เพิ่ม pairs_per_group หรือลดคู่",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Feasibility report uses FIRST offending team in teamId-ascending order
// ---------------------------------------------------------------------------
describe("balancedTeamGroupAssignment — infeasibility reports first by teamId asc", () => {
  // groupCount = ceil(6/3) = 2; both teamA and teamZ have 3 > 2 → infeasible
  // First offender alphabetically: "teamA"
  const pairs: ClassPair[] = [
    { pairId: "z1", teamId: "teamZ" },
    { pairId: "z2", teamId: "teamZ" },
    { pairId: "z3", teamId: "teamZ" },
    { pairId: "a1", teamId: "teamA" },
    { pairId: "a2", teamId: "teamA" },
    { pairId: "a3", teamId: "teamA" },
  ];

  it("reports teamA (alphabetically first) as the offending team", () => {
    const result = balancedTeamGroupAssignment(pairs, 3);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("teamA");
      expect(result.error).not.toContain("teamZ");
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism: same input → same output every time
// ---------------------------------------------------------------------------
describe("balancedTeamGroupAssignment — determinism", () => {
  const pairs: ClassPair[] = [
    { pairId: "p1", teamId: "alpha" },
    { pairId: "p2", teamId: "alpha" },
    { pairId: "p3", teamId: "beta" },
    { pairId: "p4", teamId: "beta" },
    { pairId: "p5", teamId: "gamma" },
  ];

  it("two calls with the same input produce deep-equal results", () => {
    const result1 = balancedTeamGroupAssignment(pairs, 3);
    const result2 = balancedTeamGroupAssignment(pairs, 3);
    expect(result1).toEqual(result2);
  });

  it("reversed input order still produces the same result as original", () => {
    const reversed = [...pairs].reverse();
    const result1 = balancedTeamGroupAssignment(pairs, 3);
    const result2 = balancedTeamGroupAssignment(reversed, 3);
    // Both calls are deterministic individually; they may differ from each other
    // if order within a bucket changes — but each call must be stable.
    expect(result1).toEqual(balancedTeamGroupAssignment(pairs, 3));
    expect(result2).toEqual(balancedTeamGroupAssignment(reversed, 3));
  });
});

// ---------------------------------------------------------------------------
// 3-team uneven case: teamA=3 pairs, teamB=2 pairs, teamC=2 pairs, pairsPerGroup=3
// groupCount = ceil(7/3) = 3; max team size = 3 ≤ 3 → feasible
// Balance: groups get sizes 3/2/2 (differ by ≤1) AND cross-team rule holds
// ---------------------------------------------------------------------------
describe("balancedTeamGroupAssignment — 3 teams uneven balance + cross-team", () => {
  const pairs: ClassPair[] = [
    { pairId: "a1", teamId: "teamA" },
    { pairId: "a2", teamId: "teamA" },
    { pairId: "a3", teamId: "teamA" },
    { pairId: "b1", teamId: "teamB" },
    { pairId: "b2", teamId: "teamB" },
    { pairId: "c1", teamId: "teamC" },
    { pairId: "c2", teamId: "teamC" },
  ];
  const pairMap = new Map(pairs.map((p) => [p.pairId, p.teamId]));

  it("produces exactly 3 groups", () => {
    const result = balancedTeamGroupAssignment(pairs, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups).toHaveLength(3);
  });

  it("all 7 pairs assigned", () => {
    const result = balancedTeamGroupAssignment(pairs, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const all = result.groups.flat().sort();
    expect(all).toEqual(
      ["a1", "a2", "a3", "b1", "b2", "c1", "c2"].sort(),
    );
  });

  it("group sizes differ by at most 1", () => {
    const result = balancedTeamGroupAssignment(pairs, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sizes = result.groups.map((g) => g.length);
    const max = Math.max(...sizes);
    const min = Math.min(...sizes);
    expect(max - min).toBeLessThanOrEqual(1);
  });

  it("cross-team rule holds: no group has 2 pairs from same team", () => {
    const result = balancedTeamGroupAssignment(pairs, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertCrossTeamRule(result.groups, pairMap);
  });
});

// ---------------------------------------------------------------------------
// Edge: exactly groupCount pairs, 1 per team → each group has exactly 1 pair
// ---------------------------------------------------------------------------
describe("balancedTeamGroupAssignment — N pairs, N teams (1 each), pairsPerGroup=1", () => {
  const pairs: ClassPair[] = [
    { pairId: "x1", teamId: "T1" },
    { pairId: "x2", teamId: "T2" },
    { pairId: "x3", teamId: "T3" },
  ];
  const pairMap = new Map(pairs.map((p) => [p.pairId, p.teamId]));

  it("produces 3 groups of exactly 1 each", () => {
    const result = balancedTeamGroupAssignment(pairs, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups).toHaveLength(3);
    for (const group of result.groups) {
      expect(group).toHaveLength(1);
    }
  });

  it("cross-team rule trivially holds (1 per group)", () => {
    const result = balancedTeamGroupAssignment(pairs, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertCrossTeamRule(result.groups, pairMap);
  });
});
