import { describe, it, expect } from "vitest";
import {
  gameWinner,
  leaguePoints,
  sumGameScores,
  computeStandings,
  WIN_POINTS,
  DRAW_POINTS,
} from "../scoring";
import type { Match, Game } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeMatch(
  overrides: Partial<Match> & { games: Game[] }
): Match {
  return {
    id: "m1",
    tournament_id: "t1",
    group_id: null,
    round_type: "group",
    round_number: 1,
    match_number: 1,
    team_a_id: null,
    team_b_id: null,
    pair_a_id: null,
    pair_b_id: null,
    team_a_score: null,
    team_b_score: null,
    winner_id: null,
    status: "completed",
    court: null,
    scheduled_at: null,
    next_match_id: null,
    next_match_slot: null,
    loser_next_match_id: null,
    loser_next_match_slot: null,
    bracket: null,
    division: null,
    queue_position: null,
    started_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------
describe("constants", () => {
  it("WIN_POINTS is 3", () => expect(WIN_POINTS).toBe(3));
  it("DRAW_POINTS is 1", () => expect(DRAW_POINTS).toBe(1));
});

// ---------------------------------------------------------------------------
// sumGameScores
// ---------------------------------------------------------------------------
describe("sumGameScores", () => {
  it("sums single game", () => {
    expect(sumGameScores([{ a: 21, b: 15 }])).toEqual({ a: 21, b: 15 });
  });

  it("sums multiple games", () => {
    expect(sumGameScores([{ a: 21, b: 15 }, { a: 18, b: 21 }, { a: 21, b: 10 }]))
      .toEqual({ a: 60, b: 46 });
  });

  it("empty games returns zeros", () => {
    expect(sumGameScores([])).toEqual({ a: 0, b: 0 });
  });

  it("tied scores", () => {
    expect(sumGameScores([{ a: 10, b: 10 }, { a: 5, b: 5 }])).toEqual({ a: 15, b: 15 });
  });
});

// ---------------------------------------------------------------------------
// gameWinner
// ---------------------------------------------------------------------------
describe("gameWinner", () => {
  it("returns 'a' on 2-0", () => {
    expect(gameWinner([{ a: 21, b: 15 }, { a: 21, b: 10 }])).toBe("a");
  });

  it("returns 'a' on 2-1", () => {
    expect(gameWinner([{ a: 21, b: 15 }, { a: 15, b: 21 }, { a: 21, b: 18 }])).toBe("a");
  });

  it("returns 'b' on 0-2", () => {
    expect(gameWinner([{ a: 10, b: 21 }, { a: 15, b: 21 }])).toBe("b");
  });

  it("returns 'b' on 1-2", () => {
    expect(gameWinner([{ a: 21, b: 15 }, { a: 15, b: 21 }, { a: 10, b: 21 }])).toBe("b");
  });

  it("returns 'draw' when games won are equal (1-1)", () => {
    expect(gameWinner([{ a: 21, b: 15 }, { a: 15, b: 21 }])).toBe("draw");
  });

  it("returns 'draw' for empty games array", () => {
    expect(gameWinner([])).toBe("draw");
  });

  it("returns 'draw' when all games are tied scores (same points but each game is a draw doesn't happen — both sides win 0 games)", () => {
    // A game where a === b: neither a nor b wins that individual game
    expect(gameWinner([{ a: 10, b: 10 }])).toBe("draw");
  });

  it("correctly handles a single game win for b", () => {
    expect(gameWinner([{ a: 15, b: 21 }])).toBe("b");
  });

  it("correctly handles a single game win for a", () => {
    expect(gameWinner([{ a: 21, b: 15 }])).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// leaguePoints
// ---------------------------------------------------------------------------
describe("leaguePoints", () => {
  it("3 wins, 0 draws = 9", () => expect(leaguePoints(3, 0)).toBe(9));
  it("0 wins, 3 draws = 3", () => expect(leaguePoints(0, 3)).toBe(3));
  it("2 wins, 1 draw = 7", () => expect(leaguePoints(2, 1)).toBe(7));
  it("0 wins, 0 draws = 0", () => expect(leaguePoints(0, 0)).toBe(0));
  it("1 win = 3 pts", () => expect(leaguePoints(1, 0)).toBe(3));
  it("1 draw = 1 pt", () => expect(leaguePoints(0, 1)).toBe(1));
});

// ---------------------------------------------------------------------------
// computeStandings — team unit
// ---------------------------------------------------------------------------
describe("computeStandings (team unit)", () => {
  const teamA = "team-a";
  const teamB = "team-b";
  const teamC = "team-c";

  it("returns all competitors even with no matches", () => {
    const rows = computeStandings([], "team", [teamA, teamB]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.played === 0)).toBe(true);
  });

  it("ignores non-completed matches", () => {
    const m = makeMatch({
      team_a_id: teamA,
      team_b_id: teamB,
      games: [{ a: 21, b: 10 }],
      status: "pending",
    });
    const rows = computeStandings([m], "team", [teamA, teamB]);
    expect(rows.every((r) => r.played === 0)).toBe(true);
  });

  it("records a win/loss correctly", () => {
    const m = makeMatch({
      team_a_id: teamA,
      team_b_id: teamB,
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
    });
    const rows = computeStandings([m], "team", [teamA, teamB]);
    const rowA = rows.find((r) => r.competitorId === teamA)!;
    const rowB = rows.find((r) => r.competitorId === teamB)!;

    expect(rowA.wins).toBe(1);
    expect(rowA.losses).toBe(0);
    expect(rowA.leaguePoints).toBe(3);
    expect(rowB.wins).toBe(0);
    expect(rowB.losses).toBe(1);
    expect(rowB.leaguePoints).toBe(0);
  });

  it("records a draw correctly", () => {
    const m = makeMatch({
      team_a_id: teamA,
      team_b_id: teamB,
      games: [{ a: 21, b: 15 }, { a: 15, b: 21 }],
    });
    const rows = computeStandings([m], "team", [teamA, teamB]);
    const rowA = rows.find((r) => r.competitorId === teamA)!;
    const rowB = rows.find((r) => r.competitorId === teamB)!;

    expect(rowA.draws).toBe(1);
    expect(rowA.leaguePoints).toBe(1);
    expect(rowB.draws).toBe(1);
    expect(rowB.leaguePoints).toBe(1);
  });

  it("accumulates pointsFor and pointsAgainst", () => {
    const m = makeMatch({
      team_a_id: teamA,
      team_b_id: teamB,
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
    });
    const rows = computeStandings([m], "team", [teamA, teamB]);
    const rowA = rows.find((r) => r.competitorId === teamA)!;
    const rowB = rows.find((r) => r.competitorId === teamB)!;

    expect(rowA.pointsFor).toBe(42);
    expect(rowA.pointsAgainst).toBe(25);
    expect(rowA.pointDiff).toBe(17);
    expect(rowB.pointsFor).toBe(25);
    expect(rowB.pointsAgainst).toBe(42);
    expect(rowB.pointDiff).toBe(-17);
  });

  it("sorts by league points descending (primary)", () => {
    const m1 = makeMatch({ id: "m1", team_a_id: teamA, team_b_id: teamB, games: [{ a: 21, b: 15 }, { a: 21, b: 10 }] });
    const m2 = makeMatch({ id: "m2", team_a_id: teamB, team_b_id: teamC, games: [{ a: 21, b: 15 }, { a: 21, b: 10 }] });
    const rows = computeStandings([m1, m2], "team", [teamA, teamB, teamC]);

    expect(rows[0].competitorId).toBe(teamA);
    expect(rows[1].competitorId).toBe(teamB);
    expect(rows[2].competitorId).toBe(teamC);
  });

  it("tie-breaks by point diff when league points equal", () => {
    // Both teams win once; A wins bigger
    const m1 = makeMatch({ id: "m1", team_a_id: teamA, team_b_id: teamB, games: [{ a: 21, b: 5 }, { a: 21, b: 5 }] });
    const m2 = makeMatch({ id: "m2", team_a_id: teamB, team_b_id: teamC, games: [{ a: 21, b: 20 }, { a: 21, b: 20 }] });
    const m3 = makeMatch({ id: "m3", team_a_id: teamA, team_b_id: teamC, games: [{ a: 21, b: 10 }, { a: 21, b: 10 }] });
    const rows = computeStandings([m1, m2, m3], "team", [teamA, teamB, teamC]);

    // A: 2 wins (6 pts), B: 1 win (3 pts), C: 0 wins (0 pts) — order by pts first
    expect(rows[0].competitorId).toBe(teamA);
    expect(rows[1].competitorId).toBe(teamB);
    expect(rows[2].competitorId).toBe(teamC);
  });

  it("tie-breaks by pointsFor when point diff also tied", () => {
    // A and B both have equal pointDiff but different pointsFor
    const m1 = makeMatch({ id: "m1", team_a_id: teamA, team_b_id: teamC, games: [{ a: 25, b: 20 }] });
    const m2 = makeMatch({ id: "m2", team_a_id: teamB, team_b_id: teamC, games: [{ a: 22, b: 17 }] });
    const rows = computeStandings([m1, m2], "team", [teamA, teamB, teamC]);
    const rowA = rows.find((r) => r.competitorId === teamA)!;
    const rowB = rows.find((r) => r.competitorId === teamB)!;
    // Same wins (1), same diff (+5), A has higher pointsFor (25 vs 22)
    expect(rowA.leaguePoints).toBe(rowB.leaguePoints);
    expect(rowA.pointDiff).toBe(rowB.pointDiff);
    expect(rows[0].competitorId).toBe(teamA);
  });

  it("skips matches where competitor is not in provided ids", () => {
    const outsider = "outsider-id";
    const m = makeMatch({ team_a_id: outsider, team_b_id: teamB, games: [{ a: 21, b: 10 }, { a: 21, b: 10 }] });
    const rows = computeStandings([m], "team", [teamA, teamB]);
    const rowB = rows.find((r) => r.competitorId === teamB)!;
    // outsider not in map, so rowB should be unaffected
    expect(rowB.played).toBe(0);
  });

  it("skips matches with null competitor ids", () => {
    const m = makeMatch({ team_a_id: null, team_b_id: teamB, games: [{ a: 21, b: 10 }] });
    const rows = computeStandings([m], "team", [teamA, teamB]);
    expect(rows.every((r) => r.played === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeStandings — pair unit
// ---------------------------------------------------------------------------
describe("computeStandings (pair unit)", () => {
  const pairA = "pair-a";
  const pairB = "pair-b";

  it("uses pair_a_id / pair_b_id when unit is pair", () => {
    const m = makeMatch({
      pair_a_id: pairA,
      pair_b_id: pairB,
      games: [{ a: 21, b: 10 }, { a: 21, b: 10 }],
    });
    const rows = computeStandings([m], "pair", [pairA, pairB]);
    const rowA = rows.find((r) => r.competitorId === pairA)!;
    expect(rowA.wins).toBe(1);
    expect(rowA.leaguePoints).toBe(3);
  });

  it("ignores team_a_id / team_b_id for pair unit", () => {
    const m = makeMatch({
      team_a_id: pairA, // team fields set but should be ignored
      team_b_id: pairB,
      pair_a_id: null,
      pair_b_id: null,
      games: [{ a: 21, b: 10 }, { a: 21, b: 10 }],
    });
    const rows = computeStandings([m], "pair", [pairA, pairB]);
    expect(rows.every((r) => r.played === 0)).toBe(true);
  });
});
