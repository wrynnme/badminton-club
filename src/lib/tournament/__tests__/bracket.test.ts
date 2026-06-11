import { describe, it, expect } from "vitest";
import {
  nextPowerOf2,
  buildBracket,
  buildDoubleBracket,
  roundLabel,
  lowerRoundLabel,
  selectBracketFillers,
  standingsToFillers,
} from "../bracket";
import type { BracketEntry, BracketMatchDef, BracketFiller } from "../bracket";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeEntries(n: number): BracketEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    teamId: `team-${i + 1}`,
    label: `Team ${i + 1}`,
  }));
}

function makeEntriesWithByes(total: number, realTeams: number): BracketEntry[] {
  return Array.from({ length: total }, (_, i) => ({
    teamId: i < realTeams ? `team-${i + 1}` : null,
    label: i < realTeams ? `Team ${i + 1}` : "BYE",
  }));
}

// ---------------------------------------------------------------------------
// nextPowerOf2
// ---------------------------------------------------------------------------
describe("nextPowerOf2", () => {
  it("returns 1 for n=1", () => expect(nextPowerOf2(1)).toBe(1));
  it("returns 2 for n=2", () => expect(nextPowerOf2(2)).toBe(2));
  it("returns 4 for n=3", () => expect(nextPowerOf2(3)).toBe(4));
  it("returns 4 for n=4", () => expect(nextPowerOf2(4)).toBe(4));
  it("returns 8 for n=5", () => expect(nextPowerOf2(5)).toBe(8));
  it("returns 8 for n=8", () => expect(nextPowerOf2(8)).toBe(8));
  it("returns 16 for n=9", () => expect(nextPowerOf2(9)).toBe(16));
  it("returns 16 for n=16", () => expect(nextPowerOf2(16)).toBe(16));
  it("returns 32 for n=17", () => expect(nextPowerOf2(17)).toBe(32));
  it("returns 1 for n=0", () => expect(nextPowerOf2(0)).toBe(1));
});

// ---------------------------------------------------------------------------
// buildBracket — match count
// ---------------------------------------------------------------------------
describe("buildBracket match counts", () => {
  it("4-entry bracket has 3 matches (4-1)", () => {
    const result = buildBracket(makeEntries(4));
    expect(result).toHaveLength(3);
  });

  it("8-entry bracket has 7 matches (8-1)", () => {
    const result = buildBracket(makeEntries(8));
    expect(result).toHaveLength(7);
  });

  it("16-entry bracket has 15 matches (16-1)", () => {
    const result = buildBracket(makeEntries(16));
    expect(result).toHaveLength(15);
  });

  it("2-entry bracket has 1 match", () => {
    const result = buildBracket(makeEntries(2));
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildBracket — round structure
// ---------------------------------------------------------------------------
describe("buildBracket round structure", () => {
  it("4-entry: round 1 has 2 matches, round 2 has 1 match", () => {
    const matches = buildBracket(makeEntries(4));
    const r1 = matches.filter((m) => m.roundNumber === 1);
    const r2 = matches.filter((m) => m.roundNumber === 2);
    expect(r1).toHaveLength(2);
    expect(r2).toHaveLength(1);
  });

  it("8-entry: rounds 1/2/3 have 4/2/1 matches", () => {
    const matches = buildBracket(makeEntries(8));
    expect(matches.filter((m) => m.roundNumber === 1)).toHaveLength(4);
    expect(matches.filter((m) => m.roundNumber === 2)).toHaveLength(2);
    expect(matches.filter((m) => m.roundNumber === 3)).toHaveLength(1);
  });

  it("all bracket type is 'upper'", () => {
    const matches = buildBracket(makeEntries(4));
    expect(matches.every((m) => m.bracket === "upper")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildBracket — next_match_id wiring
// ---------------------------------------------------------------------------
describe("buildBracket next_match_id wiring", () => {
  it("final match has null nextMatchId", () => {
    const matches = buildBracket(makeEntries(4));
    const final = matches.find((m) => m.roundNumber === 2)!;
    expect(final.nextMatchId).toBeNull();
    expect(final.nextMatchSlot).toBeNull();
  });

  it("R1 match next_match_id points to an R2 match id", () => {
    const matches = buildBracket(makeEntries(4));
    const r2Ids = new Set(matches.filter((m) => m.roundNumber === 2).map((m) => m.id));
    const r1Matches = matches.filter((m) => m.roundNumber === 1);
    r1Matches.forEach((m) => {
      expect(m.nextMatchId).not.toBeNull();
      expect(r2Ids.has(m.nextMatchId!)).toBe(true);
    });
  });

  it("R1 matches have nextMatchSlot 'a' or 'b'", () => {
    const matches = buildBracket(makeEntries(4));
    const r1 = matches.filter((m) => m.roundNumber === 1);
    const slots = r1.map((m) => m.nextMatchSlot);
    expect(slots).toContain("a");
    expect(slots).toContain("b");
  });

  it("8-entry: every R1 match's nextMatchId appears in R2", () => {
    const matches = buildBracket(makeEntries(8));
    const r2Ids = new Set(matches.filter((m) => m.roundNumber === 2).map((m) => m.id));
    matches
      .filter((m) => m.roundNumber === 1)
      .forEach((m) => {
        expect(r2Ids.has(m.nextMatchId!)).toBe(true);
      });
  });

  it("8-entry: every R2 match's nextMatchId appears in R3 (final)", () => {
    const matches = buildBracket(makeEntries(8));
    const r3Ids = new Set(matches.filter((m) => m.roundNumber === 3).map((m) => m.id));
    matches
      .filter((m) => m.roundNumber === 2)
      .forEach((m) => {
        expect(r3Ids.has(m.nextMatchId!)).toBe(true);
      });
  });

  it("loserNextMatchId is null for all SE matches", () => {
    const matches = buildBracket(makeEntries(8));
    expect(matches.every((m) => m.loserNextMatchId === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildBracket — team assignment
// ---------------------------------------------------------------------------
describe("buildBracket team assignment", () => {
  it("R1 matches have teamAId and teamBId set", () => {
    const matches = buildBracket(makeEntries(4));
    const r1 = matches.filter((m) => m.roundNumber === 1);
    r1.forEach((m) => {
      expect(m.teamAId).not.toBeNull();
      expect(m.teamBId).not.toBeNull();
    });
  });

  it("R2 final has null teamAId/teamBId (to be filled by results)", () => {
    const matches = buildBracket(makeEntries(4));
    const final = matches.find((m) => m.roundNumber === 2)!;
    expect(final.teamAId).toBeNull();
    expect(final.teamBId).toBeNull();
  });

  it("BYE detection: isBye=true when one slot is null in R1", () => {
    const entries = makeEntriesWithByes(4, 3); // 3 real + 1 bye
    const matches = buildBracket(entries);
    const byeMatches = matches.filter((m) => m.isBye);
    expect(byeMatches.length).toBeGreaterThan(0);
  });

  it("all 4 teams appear in R1 for a 4-entry bracket", () => {
    const matches = buildBracket(makeEntries(4));
    const r1 = matches.filter((m) => m.roundNumber === 1);
    const teamIds = new Set([
      ...r1.map((m) => m.teamAId),
      ...r1.map((m) => m.teamBId),
    ]);
    teamIds.delete(null);
    expect(teamIds.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// buildBracket — unique IDs
// ---------------------------------------------------------------------------
describe("buildBracket unique IDs", () => {
  it("all match IDs are unique", () => {
    const matches = buildBracket(makeEntries(8));
    const ids = matches.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("match numbers are sequential starting at 1", () => {
    const matches = buildBracket(makeEntries(8));
    const nums = matches.map((m) => m.matchNumber).sort((a, b) => a - b);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

// ---------------------------------------------------------------------------
// buildDoubleBracket — basic shape
// ---------------------------------------------------------------------------
describe("buildDoubleBracket", () => {
  it("4-entry DE has upper + lower + grand_final sections", () => {
    const matches = buildDoubleBracket(makeEntries(4));
    const brackets = new Set(matches.map((m) => m.bracket));
    expect(brackets.has("upper")).toBe(true);
    expect(brackets.has("lower")).toBe(true);
    expect(brackets.has("grand_final")).toBe(true);
  });

  it("4-entry DE: exactly 1 grand_final match", () => {
    const matches = buildDoubleBracket(makeEntries(4));
    expect(matches.filter((m) => m.bracket === "grand_final")).toHaveLength(1);
  });

  it("4-entry DE: 2 upper R1 matches", () => {
    const matches = buildDoubleBracket(makeEntries(4));
    const upperR1 = matches.filter((m) => m.bracket === "upper" && m.roundNumber === 1);
    expect(upperR1).toHaveLength(2);
  });

  it("4-entry DE: all IDs are unique", () => {
    const matches = buildDoubleBracket(makeEntries(4));
    const ids = matches.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("8-entry DE: all IDs are unique", () => {
    const matches = buildDoubleBracket(makeEntries(8));
    const ids = matches.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("4-entry DE: upper R1 matches have loserNextMatchId set", () => {
    const matches = buildDoubleBracket(makeEntries(4));
    const upperR1 = matches.filter((m) => m.bracket === "upper" && m.roundNumber === 1);
    upperR1.forEach((m) => {
      expect(m.loserNextMatchId).not.toBeNull();
    });
  });

  it("4-entry DE: grand_final has nextMatchId=null", () => {
    const matches = buildDoubleBracket(makeEntries(4));
    const gf = matches.find((m) => m.bracket === "grand_final")!;
    expect(gf.nextMatchId).toBeNull();
  });

  it("4-entry DE: grand_final nextMatchSlot=null, loserNextMatchSlot=null", () => {
    const matches = buildDoubleBracket(makeEntries(4));
    const gf = matches.find((m) => m.bracket === "grand_final")!;
    expect(gf.nextMatchSlot).toBeNull();
    expect(gf.loserNextMatchSlot).toBeNull();
  });

  it("4-entry DE: lower bracket matches have bracket='lower'", () => {
    const matches = buildDoubleBracket(makeEntries(4));
    const lower = matches.filter((m) => m.bracket === "lower");
    expect(lower.length).toBeGreaterThan(0);
    lower.forEach((m) => expect(m.bracket).toBe("lower"));
  });

  it("4-entry DE: upper bracket winner advances to grand_final slot 'a'", () => {
    const matches = buildDoubleBracket(makeEntries(4));
    const upperFinal = matches
      .filter((m) => m.bracket === "upper")
      .sort((a, b) => b.roundNumber - a.roundNumber)[0];
    const gf = matches.find((m) => m.bracket === "grand_final")!;
    expect(upperFinal.nextMatchId).toBe(gf.id);
    expect(upperFinal.nextMatchSlot).toBe("a");
  });

  it("4-entry DE: lower bracket final advances to grand_final slot 'b'", () => {
    const matches = buildDoubleBracket(makeEntries(4));
    const lowerMatches = matches.filter((m) => m.bracket === "lower");
    const lowerFinal = lowerMatches.sort((a, b) => b.roundNumber - a.roundNumber)[0];
    const gf = matches.find((m) => m.bracket === "grand_final")!;
    expect(lowerFinal.nextMatchId).toBe(gf.id);
    expect(lowerFinal.nextMatchSlot).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// roundLabel
// ---------------------------------------------------------------------------
describe("roundLabel", () => {
  it("final round → 'รอบชิงชนะเลิศ'", () => {
    expect(roundLabel(3, 3, 8)).toBe("รอบชิงชนะเลิศ");
  });

  it("semi-final round → 'รอบรองชนะเลิศ'", () => {
    expect(roundLabel(2, 3, 8)).toBe("รอบรองชนะเลิศ");
  });

  it("quarter-final round (maxRound ≥ 4) → 'รอบก่อนรองชนะเลิศ'", () => {
    expect(roundLabel(2, 4, 16)).toBe("รอบก่อนรองชนะเลิศ");
  });

  it("round 1 of 3 (bracketSize 8) → uses team count format", () => {
    const label = roundLabel(1, 3, 8);
    expect(label).toBe("รอบ 8 ทีม");
  });

  it("round 1 of 4 (bracketSize 16) → 'รอบ 16 ทีม'", () => {
    expect(roundLabel(1, 4, 16)).toBe("รอบ 16 ทีม");
  });

  it("round 3 of 4 (bracketSize 16) → 'รอบรองชนะเลิศ'", () => {
    expect(roundLabel(3, 4, 16)).toBe("รอบรองชนะเลิศ");
  });
});

// ---------------------------------------------------------------------------
// lowerRoundLabel
// ---------------------------------------------------------------------------
describe("lowerRoundLabel", () => {
  it("final lower round → 'Lower Final'", () => {
    expect(lowerRoundLabel(4, 4)).toBe("Lower Final");
  });

  it("non-final lower round → 'สายล่าง รอบ N'", () => {
    expect(lowerRoundLabel(1, 4)).toBe("สายล่าง รอบ 1");
    expect(lowerRoundLabel(2, 4)).toBe("สายล่าง รอบ 2");
    expect(lowerRoundLabel(3, 4)).toBe("สายล่าง รอบ 3");
  });
});

describe("selectBracketFillers (T2 — best Nth place)", () => {
  const f = (teamId: string, groupRank: number, pts: number, diff = 0, pf = 0): BracketFiller => ({
    teamId, name: teamId, groupRank, pts, diff, pf,
  });

  it("returns [] when need <= 0", () => {
    expect(selectBracketFillers([f("a", 3, 6)], 0)).toEqual([]);
    expect(selectBracketFillers([f("a", 3, 6)], -1)).toEqual([]);
  });

  it("picks best 3rd-placers across groups to fill (6 groups → KO16, need 4)", () => {
    // 6 groups, advance 2 each = 12; each group's 3rd-placer (groupRank 3) competes for 4 slots
    const thirds = [
      f("A3", 3, 6, 8, 52), f("D3", 3, 6, 5, 48), f("B3", 3, 6, 5, 44),
      f("F3", 3, 4, 2, 40), f("C3", 3, 4, -1, 38), f("E3", 3, 3, -4, 35),
    ];
    const picked = selectBracketFillers(thirds, 4).map((x) => x.teamId);
    expect(picked).toEqual(["A3", "D3", "B3", "F3"]);
  });

  it("ranks finishing position before score (every 3rd beats any 4th)", () => {
    const rest = [f("g4", 4, 99, 99, 99), f("g3", 3, 1, 0, 0)];
    expect(selectBracketFillers(rest, 1).map((x) => x.teamId)).toEqual(["g3"]);
  });

  it("returns fewer than need when not enough rest teams (slots stay BYE)", () => {
    expect(selectBracketFillers([f("a", 3, 6)], 4)).toHaveLength(1);
    expect(selectBracketFillers([], 4)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const rest = [f("a", 3, 1), f("b", 3, 9)];
    const copy = [...rest];
    selectBracketFillers(rest, 2);
    expect(rest).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// standingsToFillers
// ---------------------------------------------------------------------------
describe("standingsToFillers", () => {
  // Helper: build a minimal standings row accepted by standingsToFillers.
  function row(
    competitorId: string,
    leaguePoints: number,
    pointDiff: number,
    pointsFor: number,
  ) {
    return { competitorId, leaguePoints, pointDiff, pointsFor };
  }

  const nameOf = (id: string) => `Name:${id}`;

  it("(a) maps all fields correctly for a single row", () => {
    const result = standingsToFillers([row("pair-1", 6, 12, 48)], 3, nameOf);
    expect(result).toHaveLength(1);
    const filler = result[0];
    expect(filler.teamId).toBe("pair-1");
    expect(filler.name).toBe("Name:pair-1");
    expect(filler.groupRank).toBe(3);        // startRank + 0
    expect(filler.pts).toBe(6);              // leaguePoints
    expect(filler.diff).toBe(12);            // pointDiff
    expect(filler.pf).toBe(48);              // pointsFor
  });

  it("(a) groupRank increments by index across multiple rows", () => {
    const rows = [
      row("p1", 6, 5, 40),
      row("p2", 3, 0, 30),
      row("p3", 0, -5, 20),
    ];
    const result = standingsToFillers(rows, 3, nameOf);
    expect(result.map((r) => r.groupRank)).toEqual([3, 4, 5]);
  });

  it("(b) empty input → empty output", () => {
    expect(standingsToFillers([], 3, nameOf)).toEqual([]);
  });

  it("(b) does not mutate the input array", () => {
    const rows = [row("p1", 6, 5, 40), row("p2", 3, 0, 30)];
    const copy = rows.map((r) => ({ ...r }));
    standingsToFillers(rows, 3, nameOf);
    expect(rows).toEqual(copy);
  });

  it("(c) integration: cross-group best-3rd pick — groupRank dominates pts", () => {
    // Group A: 3rd-placer (rank 3, low pts)
    // Group B: 3rd-placer (rank 3, high pts)
    // Group A: 4th-placer (rank 4, very high pts) — must NOT beat any 3rd-placer
    // advance_count = 2, so startRank = 3
    const groupA_rest = standingsToFillers(
      [row("A3", 1, -2, 20), row("A4", 9, 8, 60)],
      3,
      nameOf,
    );
    const groupB_rest = standingsToFillers(
      [row("B3", 6, 5, 50), row("B4", 4, 2, 35)],
      3,
      nameOf,
    );

    const allRest = [...groupA_rest, ...groupB_rest];
    // need = nextPowerOf2(4) - 4 = 0 if we had 4 seeds, but suppose we need 1 filler:
    // pick the best single filler — B3 (rank 3, pts 6) beats A3 (rank 3, pts 1);
    // A4 and B4 (rank 4) both lose to any rank-3 entry.
    const picked1 = selectBracketFillers(allRest, 1);
    expect(picked1[0].teamId).toBe("B3");

    // pick 2: B3 then A3 (both rank-3), A4/B4 rank-4 still excluded
    const picked2 = selectBracketFillers(allRest, 2);
    expect(picked2.map((x) => x.teamId)).toEqual(["B3", "A3"]);

    // pick 3: adds best rank-4 (B4, pts 4 > A4 pts… wait A4 has pts 9 > B4 pts 4)
    // groupRank 4 tie broken by pts: A4 (pts 9) > B4 (pts 4)
    const picked3 = selectBracketFillers(allRest, 3);
    expect(picked3.map((x) => x.teamId)).toEqual(["B3", "A3", "A4"]);
  });
});
