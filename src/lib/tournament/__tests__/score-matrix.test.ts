import { describe, it, expect } from "vitest";
import { buildScoreMatrix } from "../score-matrix";
import type { CellResult } from "../score-matrix";
import type { Match, Game } from "@/lib/types";

// ---------------------------------------------------------------------------
// Factory helper — fills every required Match field with safe defaults;
// callers override only what is relevant to the test.
// ---------------------------------------------------------------------------
function makeMatch(overrides: Partial<Match> & { games: Game[] }): Match {
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

// Convenience IDs
const A = "team-a";
const B = "team-b";
const C = "team-c";

const PA = "pair-a";
const PB = "pair-b";

// ---------------------------------------------------------------------------
// Helper: assert a cell has a specific state (type-narrowed for TS)
// ---------------------------------------------------------------------------
function cellState(cell: CellResult | undefined): string {
  return cell?.state ?? "undefined";
}

// ---------------------------------------------------------------------------
// Case 1 — empty matches
// ---------------------------------------------------------------------------
describe("buildScoreMatrix — empty matches", () => {
  it("all off-diagonal cells are 'none'", () => {
    const grid = buildScoreMatrix([], [A, B, C], "team");

    // Every off-diagonal cell must be { state: "none" }
    const ids = [A, B, C];
    for (const row of ids) {
      for (const col of ids) {
        if (row !== col) {
          expect(cellState(grid.get(row)?.get(col))).toBe("none");
        }
      }
    }
  });

  it("diagonal entries are NOT stored (has() returns false)", () => {
    const grid = buildScoreMatrix([], [A, B, C], "team");
    for (const id of [A, B, C]) {
      expect(grid.get(id)?.has(id)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Case 2 — completed match, both directions
// Games [{a:21,b:19},{a:15,b:21},{a:21,b:18}]
//   sumGameScores → {a:57, b:58}   (21+15+21=57, 19+21+18=58)
//   gameWinner    → "a"  (aWins=2, bWins=1)
// ---------------------------------------------------------------------------
describe("buildScoreMatrix — completed match, bidirectional cells", () => {
  const games: Game[] = [
    { a: 21, b: 19 },
    { a: 15, b: 21 },
    { a: 21, b: 18 },
  ];
  const grid = buildScoreMatrix(
    [
      makeMatch({
        id: "m1",
        team_a_id: A,
        team_b_id: B,
        team_a_score: 2,
        team_b_score: 1,
        games,
      }),
    ],
    [A, B],
    "team",
  );

  it("A→B cell reflects A's perspective: result=W, rowGames=2, colGames=1", () => {
    const cell = grid.get(A)?.get(B);
    expect(cell).toEqual({
      state: "score",
      rowGames: 2,
      colGames: 1,
      rowPoints: 57,
      colPoints: 58,
      result: "W",
    });
  });

  it("B→A cell reflects B's perspective: result=L, rowGames=1, colGames=2 (points flipped)", () => {
    const cell = grid.get(B)?.get(A);
    expect(cell).toEqual({
      state: "score",
      rowGames: 1,
      colGames: 2,
      rowPoints: 58,
      colPoints: 57,
      result: "L",
    });
  });
});

// ---------------------------------------------------------------------------
// Case 3 — draw (1-1 games)
// ---------------------------------------------------------------------------
describe("buildScoreMatrix — draw", () => {
  const games: Game[] = [{ a: 21, b: 15 }, { a: 15, b: 21 }];
  const grid = buildScoreMatrix(
    [makeMatch({ id: "m1", team_a_id: A, team_b_id: B, team_a_score: 1, team_b_score: 1, games })],
    [A, B],
    "team",
  );

  it("A→B result is 'D'", () => {
    const cell = grid.get(A)?.get(B);
    expect(cell?.state).toBe("score");
    if (cell?.state === "score") expect(cell.result).toBe("D");
  });

  it("B→A result is also 'D'", () => {
    const cell = grid.get(B)?.get(A);
    expect(cell?.state).toBe("score");
    if (cell?.state === "score") expect(cell.result).toBe("D");
  });
});

// ---------------------------------------------------------------------------
// Case 4 — BYE walkover (completed but games.length === 0)
// ---------------------------------------------------------------------------
describe("buildScoreMatrix — BYE walkover (completed, games=[])", () => {
  const grid = buildScoreMatrix(
    [makeMatch({ id: "m1", team_a_id: A, team_b_id: B, status: "completed", games: [] })],
    [A, B],
    "team",
  );

  it("A→B cell is 'scheduled' (not 'score') — BYE must never count as a result", () => {
    expect(cellState(grid.get(A)?.get(B))).toBe("scheduled");
    expect(cellState(grid.get(A)?.get(B))).not.toBe("score");
  });

  it("B→A cell is also 'scheduled'", () => {
    expect(cellState(grid.get(B)?.get(A))).toBe("scheduled");
    expect(cellState(grid.get(B)?.get(A))).not.toBe("score");
  });
});

// ---------------------------------------------------------------------------
// Case 5 — pending match → "scheduled"
// ---------------------------------------------------------------------------
describe("buildScoreMatrix — pending match", () => {
  const grid = buildScoreMatrix(
    [makeMatch({ id: "m1", team_a_id: A, team_b_id: B, status: "pending", games: [] })],
    [A, B],
    "team",
  );

  it("A→B is 'scheduled'", () => {
    expect(cellState(grid.get(A)?.get(B))).toBe("scheduled");
  });

  it("B→A is 'scheduled'", () => {
    expect(cellState(grid.get(B)?.get(A))).toBe("scheduled");
  });
});

// ---------------------------------------------------------------------------
// Case 5b — in_progress match → "scheduled"
// ---------------------------------------------------------------------------
describe("buildScoreMatrix — in_progress match", () => {
  const grid = buildScoreMatrix(
    [makeMatch({ id: "m1", team_a_id: A, team_b_id: B, status: "in_progress", games: [] })],
    [A, B],
    "team",
  );

  it("A→B is 'scheduled'", () => {
    expect(cellState(grid.get(A)?.get(B))).toBe("scheduled");
  });

  it("B→A is 'scheduled'", () => {
    expect(cellState(grid.get(B)?.get(A))).toBe("scheduled");
  });
});

// ---------------------------------------------------------------------------
// Case 6 — "scheduled" must NOT downgrade an existing "score" cell
// The pending match has a HIGHER match_number so it is processed AFTER the
// completed match in ASC sort order.
// ---------------------------------------------------------------------------
describe("buildScoreMatrix — pending does not downgrade completed score", () => {
  const games: Game[] = [{ a: 21, b: 15 }, { a: 21, b: 10 }];
  const grid = buildScoreMatrix(
    [
      makeMatch({
        id: "m1",
        match_number: 1,
        team_a_id: A,
        team_b_id: B,
        team_a_score: 2,
        team_b_score: 0,
        status: "completed",
        games,
      }),
      makeMatch({
        id: "m2",
        match_number: 2,
        team_a_id: A,
        team_b_id: B,
        status: "pending",
        games: [],
      }),
    ],
    [A, B],
    "team",
  );

  it("A→B remains 'score' despite subsequent pending match", () => {
    expect(cellState(grid.get(A)?.get(B))).toBe("score");
  });

  it("B→A remains 'score' despite subsequent pending match", () => {
    expect(cellState(grid.get(B)?.get(A))).toBe("score");
  });
});

// ---------------------------------------------------------------------------
// Case 7 — duplicate fixture: highest match_number wins
// Input array order is REVERSED (higher match_number first) to prove the
// function sorts by match_number rather than relying on array order.
// ---------------------------------------------------------------------------
describe("buildScoreMatrix — duplicate fixture: highest match_number wins", () => {
  const gamesFirst: Game[] = [{ a: 21, b: 10 }, { a: 21, b: 10 }]; // A wins 2-0
  const gamesSecond: Game[] = [{ a: 10, b: 21 }, { a: 10, b: 21 }]; // B wins 2-0

  // Deliberately place the HIGHER match_number match FIRST in the array.
  // If the function relied on array order (last-write), match_number=1 (gamesFirst)
  // would win. Correct behaviour (sort ASC then last-write) means match_number=2
  // (gamesSecond) wins.
  const grid = buildScoreMatrix(
    [
      makeMatch({
        id: "m2",
        match_number: 2,
        team_a_id: A,
        team_b_id: B,
        team_a_score: 0,
        team_b_score: 2,
        status: "completed",
        games: gamesSecond,
      }),
      makeMatch({
        id: "m1",
        match_number: 1,
        team_a_id: A,
        team_b_id: B,
        team_a_score: 2,
        team_b_score: 0,
        status: "completed",
        games: gamesFirst,
      }),
    ],
    [A, B],
    "team",
  );

  it("A→B result is 'L' (match_number=2, B won) — proves sort runs, not array order", () => {
    const cell = grid.get(A)?.get(B);
    expect(cell?.state).toBe("score");
    if (cell?.state === "score") expect(cell.result).toBe("L");
  });

  it("B→A result is 'W'", () => {
    const cell = grid.get(B)?.get(A);
    expect(cell?.state).toBe("score");
    if (cell?.state === "score") expect(cell.result).toBe("W");
  });
});

// ---------------------------------------------------------------------------
// Case 8 — null side (team_a_id=null) → match skipped, no crash
// ---------------------------------------------------------------------------
describe("buildScoreMatrix — null side skips match", () => {
  const grid = buildScoreMatrix(
    [
      makeMatch({
        id: "m1",
        team_a_id: null, // missing side A
        team_b_id: B,
        status: "completed",
        games: [{ a: 21, b: 10 }, { a: 21, b: 10 }],
      }),
    ],
    [A, B],
    "team",
  );

  it("does not throw", () => {
    expect(() =>
      buildScoreMatrix(
        [makeMatch({ id: "m1", team_a_id: null, team_b_id: B, games: [{ a: 21, b: 10 }] })],
        [A, B],
        "team",
      ),
    ).not.toThrow();
  });

  it("A→B remains 'none' (match was skipped)", () => {
    expect(cellState(grid.get(A)?.get(B))).toBe("none");
  });

  it("B→A remains 'none' (match was skipped)", () => {
    expect(cellState(grid.get(B)?.get(A))).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Case 9 — cross-group guard: competitor IDs not in competitorIds → skipped
// ---------------------------------------------------------------------------
describe("buildScoreMatrix — cross-group guard (ids not in competitorIds)", () => {
  const outsider = "outsider-id";
  const grid = buildScoreMatrix(
    [
      makeMatch({
        id: "m1",
        team_a_id: outsider,
        team_b_id: B,
        status: "completed",
        games: [{ a: 21, b: 10 }, { a: 21, b: 10 }],
      }),
    ],
    [A, B], // outsider not listed
    "team",
  );

  it("B→A cell stays 'none' (outsider was not in competitorIds)", () => {
    expect(cellState(grid.get(B)?.get(A))).toBe("none");
  });

  it("grid has no row for outsider", () => {
    expect(grid.has(outsider)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Case 10 — unit="pair" reads pair_a_id / pair_b_id, not team_*
// ---------------------------------------------------------------------------
describe("buildScoreMatrix — unit='pair' uses pair IDs", () => {
  const games: Game[] = [{ a: 21, b: 15 }, { a: 21, b: 10 }];

  it("populates cells using pair_a_id / pair_b_id", () => {
    const grid = buildScoreMatrix(
      [
        makeMatch({
          id: "m1",
          // Bogus team IDs — should be ignored
          team_a_id: "bogus-team-a",
          team_b_id: "bogus-team-b",
          // Real pair IDs
          pair_a_id: PA,
          pair_b_id: PB,
          team_a_score: 2,
          team_b_score: 0,
          games,
        }),
      ],
      [PA, PB],
      "pair",
    );

    expect(cellState(grid.get(PA)?.get(PB))).toBe("score");
    expect(cellState(grid.get(PB)?.get(PA))).toBe("score");
  });

  it("PA→PB result is 'W' (pair A won 2-0)", () => {
    const grid = buildScoreMatrix(
      [
        makeMatch({
          id: "m1",
          pair_a_id: PA,
          pair_b_id: PB,
          team_a_score: 2,
          team_b_score: 0,
          games,
        }),
      ],
      [PA, PB],
      "pair",
    );
    const cell = grid.get(PA)?.get(PB);
    expect(cell?.state).toBe("score");
    if (cell?.state === "score") expect(cell.result).toBe("W");
  });
});

// ---------------------------------------------------------------------------
// Case 10b — unit="team" with only pair IDs set → match skipped
// ---------------------------------------------------------------------------
describe("buildScoreMatrix — unit='team' ignores pair IDs (null team side → skipped)", () => {
  const grid = buildScoreMatrix(
    [
      makeMatch({
        id: "m1",
        team_a_id: null, // no team IDs
        team_b_id: null,
        pair_a_id: PA,
        pair_b_id: PB,
        games: [{ a: 21, b: 10 }, { a: 21, b: 10 }],
      }),
    ],
    [A, B],
    "team",
  );

  it("cells remain 'none' (team IDs were null, pair IDs irrelevant for unit=team)", () => {
    expect(cellState(grid.get(A)?.get(B))).toBe("none");
    expect(cellState(grid.get(B)?.get(A))).toBe("none");
  });
});
