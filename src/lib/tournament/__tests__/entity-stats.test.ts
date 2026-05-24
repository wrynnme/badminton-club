import { describe, it, expect } from "vitest";
import { computePairStats, computePlayerStats, computeTeamStats, computeDivisionStats } from "../entity-stats";
import type { Match, Game, PairWithPlayers, TeamPlayer } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
let _matchCounter = 0;
function makeMatch(overrides: Partial<Match> & { games: Game[] }): Match {
  _matchCounter++;
  return {
    id: `m${_matchCounter}`,
    tournament_id: "t1",
    group_id: null,
    round_type: "group",
    round_number: 1,
    match_number: _matchCounter,
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

const PAIR_A = "pair-a";
const PAIR_B = "pair-b";
const PAIR_C = "pair-c";

// ---------------------------------------------------------------------------
// 1. Zero matches → empty stats
// ---------------------------------------------------------------------------
describe("computePairStats — 0 matches", () => {
  it("returns zeroed stats when no matches provided", () => {
    const stats = computePairStats({ pairId: PAIR_A, matches: [] });
    expect(stats.entityType).toBe("pair");
    expect(stats.entityId).toBe(PAIR_A);
    expect(stats.played).toBe(0);
    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(0);
    expect(stats.draws).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.pointsFor).toBe(0);
    expect(stats.pointsAgainst).toBe(0);
    expect(stats.pointsDiff).toBe(0);
    expect(stats.streak).toEqual({ type: null, length: 0 });
    expect(stats.matches).toHaveLength(0);
    expect(Object.keys(stats.headToHead)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Pair not in any match → same as empty
// ---------------------------------------------------------------------------
describe("computePairStats — pair never participates", () => {
  it("returns empty stats when pair_a/b never matches the pairId", () => {
    const m = makeMatch({
      pair_a_id: PAIR_B,
      pair_b_id: PAIR_C,
      games: [{ a: 21, b: 15 }, { a: 21, b: 15 }],
    });
    const stats = computePairStats({ pairId: PAIR_A, matches: [m] });
    expect(stats.played).toBe(0);
    expect(stats.matches).toHaveLength(0);
    expect(Object.keys(stats.headToHead)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Non-completed matches are ignored
// ---------------------------------------------------------------------------
describe("computePairStats — filters non-completed", () => {
  it("ignores pending matches", () => {
    const m = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: PAIR_B,
      games: [{ a: 21, b: 10 }, { a: 21, b: 10 }],
      status: "pending",
    });
    const stats = computePairStats({ pairId: PAIR_A, matches: [m] });
    expect(stats.played).toBe(0);
  });

  it("ignores in_progress matches", () => {
    const m = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: PAIR_B,
      games: [{ a: 21, b: 10 }],
      status: "in_progress",
    });
    const stats = computePairStats({ pairId: PAIR_A, matches: [m] });
    expect(stats.played).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. W/L/D mix + win rate + streak
// ---------------------------------------------------------------------------
describe("computePairStats — 3 matches: 2W 1L", () => {
  // Arrange: m1=W, m2=W, m3=L (so streak is L-length-1)
  // match_number is auto-incremented by makeMatch, ensuring sort order
  const m1 = makeMatch({
    pair_a_id: PAIR_A,
    pair_b_id: PAIR_B,
    games: [{ a: 21, b: 15 }, { a: 21, b: 10 }], // A wins 2-0
  });
  const m2 = makeMatch({
    pair_a_id: PAIR_B,
    pair_b_id: PAIR_A,
    games: [{ a: 10, b: 21 }, { a: 15, b: 21 }], // B wins 2-0, but A is side B → A wins
  });
  const m3 = makeMatch({
    pair_a_id: PAIR_A,
    pair_b_id: PAIR_B,
    games: [{ a: 10, b: 21 }, { a: 15, b: 21 }], // B wins 2-0, A is side A → A loses
  });

  it("counts 2 wins, 1 loss, 0 draws", () => {
    const stats = computePairStats({ pairId: PAIR_A, matches: [m1, m2, m3] });
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.draws).toBe(0);
    expect(stats.played).toBe(3);
  });

  it("win rate is 2/3", () => {
    const stats = computePairStats({ pairId: PAIR_A, matches: [m1, m2, m3] });
    expect(stats.winRate).toBeCloseTo(2 / 3);
  });

  it("streak is L-1 (last match was a loss)", () => {
    const stats = computePairStats({ pairId: PAIR_A, matches: [m1, m2, m3] });
    expect(stats.streak).toEqual({ type: "L", length: 1 });
  });
});

// ---------------------------------------------------------------------------
// 5. pointsFor / pointsAgainst from games
// ---------------------------------------------------------------------------
describe("computePairStats — pointsFor / pointsAgainst", () => {
  it("aggregates correctly when pair is side A", () => {
    const m = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: PAIR_B,
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
    });
    const stats = computePairStats({ pairId: PAIR_A, matches: [m] });
    expect(stats.pointsFor).toBe(42);
    expect(stats.pointsAgainst).toBe(25);
    expect(stats.pointsDiff).toBe(17);
  });

  it("aggregates correctly when pair is side B (flips perspective)", () => {
    const m = makeMatch({
      pair_a_id: PAIR_B,
      pair_b_id: PAIR_A,
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
    });
    const stats = computePairStats({ pairId: PAIR_A, matches: [m] });
    // A is side B: pointsFor=15+10=25, pointsAgainst=21+21=42
    expect(stats.pointsFor).toBe(25);
    expect(stats.pointsAgainst).toBe(42);
    expect(stats.pointsDiff).toBe(-17);
  });
});

// ---------------------------------------------------------------------------
// 6. headToHead grouping
// ---------------------------------------------------------------------------
describe("computePairStats — headToHead", () => {
  it("groups by opponent pair id", () => {
    const m1 = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: PAIR_B,
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }], // A wins
    });
    const m2 = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: PAIR_C,
      games: [{ a: 10, b: 21 }, { a: 15, b: 21 }], // A loses
    });
    const m3 = makeMatch({
      pair_a_id: PAIR_B,
      pair_b_id: PAIR_A,
      games: [{ a: 21, b: 10 }, { a: 21, b: 10 }], // A is side B, loses
    });

    const stats = computePairStats({ pairId: PAIR_A, matches: [m1, m2, m3] });

    const vsB = stats.headToHead[PAIR_B];
    expect(vsB).toBeDefined();
    expect(vsB!.played).toBe(2);
    expect(vsB!.wins).toBe(1);
    expect(vsB!.losses).toBe(1);
    expect(vsB!.draws).toBe(0);

    const vsC = stats.headToHead[PAIR_C];
    expect(vsC).toBeDefined();
    expect(vsC!.played).toBe(1);
    expect(vsC!.wins).toBe(0);
    expect(vsC!.losses).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. Streak calculation — consecutive wins → W streak
// ---------------------------------------------------------------------------
describe("computePairStats — streak (all wins)", () => {
  it("reports W-2 streak when last 2 matches are wins (chronological order)", () => {
    const m1 = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: PAIR_B,
      games: [{ a: 10, b: 21 }, { a: 10, b: 21 }], // A loses first
    });
    const m2 = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: PAIR_B,
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }], // A wins
    });
    const m3 = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: PAIR_B,
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }], // A wins
    });
    const stats = computePairStats({ pairId: PAIR_A, matches: [m1, m2, m3] });
    expect(stats.streak).toEqual({ type: "W", length: 2 });
  });
});

// ---------------------------------------------------------------------------
// 8. Draw handling
// ---------------------------------------------------------------------------
describe("computePairStats — draw", () => {
  it("records a draw correctly (1-1 games)", () => {
    const m = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: PAIR_B,
      games: [{ a: 21, b: 15 }, { a: 15, b: 21 }], // each wins 1 game → draw
    });
    const stats = computePairStats({ pairId: PAIR_A, matches: [m] });
    expect(stats.draws).toBe(1);
    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.streak).toEqual({ type: "D", length: 1 });
  });
});

// ===========================================================================
// computePlayerStats
// ===========================================================================

// ---------------------------------------------------------------------------
// Helper — build minimal PairWithPlayers
// ---------------------------------------------------------------------------
function makePlayer(id: string, displayName = `Player ${id}`): TeamPlayer {
  return {
    id,
    team_id: "team-1",
    profile_id: null,
    display_name: displayName,
    role: "member",
    level: null,
    csv_id: null,
    checked_in_at: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function makePair(
  id: string,
  player1Id: string,
  player2Id: string | null = null
): PairWithPlayers {
  return {
    id,
    team_id: "team-1",
    player_id_1: player1Id,
    player_id_2: player2Id,
    display_pair_name: null,
    pair_level: null,
    created_at: "2026-01-01T00:00:00Z",
    player1: makePlayer(player1Id),
    player2: player2Id ? makePlayer(player2Id) : null,
  };
}

const PLAYER_X = "player-x";
const PLAYER_Y = "player-y";
const PLAYER_Z = "player-z";
const PLAYER_W = "player-w";

// Pair X+Y (primary pair for player X)
const PAIR_XY = "pair-xy";
// Pair X+Z (second pair — rare case where player is in 2 pairs)
const PAIR_XZ = "pair-xz";
// Opponent pairs
const PAIR_OP1 = "pair-op1";
const PAIR_OP2 = "pair-op2";

// ---------------------------------------------------------------------------
// 9. Player not in any pair → 0 played
// ---------------------------------------------------------------------------
describe("computePlayerStats — player not in any pair", () => {
  it("returns zeroed stats when player has no pairs", () => {
    const m = makeMatch({
      pair_a_id: PAIR_XY,
      pair_b_id: PAIR_OP1,
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
    });
    const stats = computePlayerStats({
      playerId: "unknown-player",
      pairs: [makePair(PAIR_XY, PLAYER_X, PLAYER_Y)],
      matches: [m],
    });
    expect(stats.entityType).toBe("player");
    expect(stats.entityId).toBe("unknown-player");
    expect(stats.played).toBe(0);
    expect(stats.matches).toHaveLength(0);
    expect(Object.keys(stats.headToHead)).toHaveLength(0);
    expect(Object.keys(stats.partnerBreakdown)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Player in 1 pair, 3 completed matches → standard aggregation
// ---------------------------------------------------------------------------
describe("computePlayerStats — 1 pair, 3 matches", () => {
  const pairs = [makePair(PAIR_XY, PLAYER_X, PLAYER_Y)];

  // m1: PAIR_XY is side A, wins 2-0
  const m1 = makeMatch({
    pair_a_id: PAIR_XY,
    pair_b_id: PAIR_OP1,
    games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
  });
  // m2: PAIR_XY is side B, wins (B wins 2-0 → side B wins)
  const m2 = makeMatch({
    pair_a_id: PAIR_OP1,
    pair_b_id: PAIR_XY,
    games: [{ a: 10, b: 21 }, { a: 15, b: 21 }],
  });
  // m3: PAIR_XY is side A, loses 0-2
  const m3 = makeMatch({
    pair_a_id: PAIR_XY,
    pair_b_id: PAIR_OP1,
    games: [{ a: 10, b: 21 }, { a: 15, b: 21 }],
  });

  it("counts 2 wins 1 loss", () => {
    const stats = computePlayerStats({ playerId: PLAYER_X, pairs, matches: [m1, m2, m3] });
    expect(stats.played).toBe(3);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.draws).toBe(0);
  });

  it("win rate is 2/3", () => {
    const stats = computePlayerStats({ playerId: PLAYER_X, pairs, matches: [m1, m2, m3] });
    expect(stats.winRate).toBeCloseTo(2 / 3);
  });

  it("streak is L-1 (last match was a loss)", () => {
    const stats = computePlayerStats({ playerId: PLAYER_X, pairs, matches: [m1, m2, m3] });
    expect(stats.streak).toEqual({ type: "L", length: 1 });
  });

  it("aggregates pointsFor and pointsAgainst correctly", () => {
    const stats = computePlayerStats({ playerId: PLAYER_X, pairs, matches: [m1, m2, m3] });
    // m1 (sideA): for=42, against=25
    // m2 (sideB): for=21+21=42, against=10+15=25
    // m3 (sideA): for=25, against=42
    expect(stats.pointsFor).toBe(42 + 42 + 25);
    expect(stats.pointsAgainst).toBe(25 + 25 + 42);
  });
});

// ---------------------------------------------------------------------------
// 11. Player in 2 different pairs → matches from both counted
// ---------------------------------------------------------------------------
describe("computePlayerStats — player in 2 pairs", () => {
  const pairs = [
    makePair(PAIR_XY, PLAYER_X, PLAYER_Y),
    makePair(PAIR_XZ, PLAYER_X, PLAYER_Z),
  ];

  // Match via pair XY vs OP1 — X wins
  const m1 = makeMatch({
    pair_a_id: PAIR_XY,
    pair_b_id: PAIR_OP1,
    games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
  });
  // Match via pair XZ vs OP2 — X loses
  const m2 = makeMatch({
    pair_a_id: PAIR_XZ,
    pair_b_id: PAIR_OP2,
    games: [{ a: 10, b: 21 }, { a: 15, b: 21 }],
  });

  it("counts matches from both pairs", () => {
    const stats = computePlayerStats({ playerId: PLAYER_X, pairs, matches: [m1, m2] });
    expect(stats.played).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
  });

  it("headToHead contains both opponent pairs", () => {
    const stats = computePlayerStats({ playerId: PLAYER_X, pairs, matches: [m1, m2] });
    expect(stats.headToHead[PAIR_OP1]).toBeDefined();
    expect(stats.headToHead[PAIR_OP2]).toBeDefined();
    expect(stats.headToHead[PAIR_OP1]?.wins).toBe(1);
    expect(stats.headToHead[PAIR_OP2]?.losses).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 12. partnerBreakdown groups correctly by partner player id
// ---------------------------------------------------------------------------
describe("computePlayerStats — partnerBreakdown", () => {
  const pairXY = makePair(PAIR_XY, PLAYER_X, PLAYER_Y);
  const pairXW = makePair(PAIR_XZ, PLAYER_X, PLAYER_W); // reuse PAIR_XZ id, different partner
  const pairs = [pairXY, pairXW];

  // m1 + m2: played with Y (1W 1L)
  const m1 = makeMatch({
    pair_a_id: PAIR_XY,
    pair_b_id: PAIR_OP1,
    games: [{ a: 21, b: 15 }, { a: 21, b: 10 }], // W
  });
  const m2 = makeMatch({
    pair_a_id: PAIR_XY,
    pair_b_id: PAIR_OP1,
    games: [{ a: 10, b: 21 }, { a: 15, b: 21 }], // L
  });
  // m3: played with W (1W)
  const m3 = makeMatch({
    pair_a_id: PAIR_XZ,
    pair_b_id: PAIR_OP2,
    games: [{ a: 21, b: 10 }, { a: 21, b: 15 }], // W
  });

  it("tracks partner Y: 2 played, 1W 1L", () => {
    const stats = computePlayerStats({ playerId: PLAYER_X, pairs, matches: [m1, m2, m3] });
    const withY = stats.partnerBreakdown[PLAYER_Y];
    expect(withY).toBeDefined();
    expect(withY!.played).toBe(2);
    expect(withY!.wins).toBe(1);
    expect(withY!.losses).toBe(1);
    expect(withY!.draws).toBe(0);
  });

  it("tracks partner W: 1 played, 1W", () => {
    const stats = computePlayerStats({ playerId: PLAYER_X, pairs, matches: [m1, m2, m3] });
    const withW = stats.partnerBreakdown[PLAYER_W];
    expect(withW).toBeDefined();
    expect(withW!.played).toBe(1);
    expect(withW!.wins).toBe(1);
  });

  it("partnerBreakdown has exactly 2 partners", () => {
    const stats = computePlayerStats({ playerId: PLAYER_X, pairs, matches: [m1, m2, m3] });
    expect(Object.keys(stats.partnerBreakdown)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 13. headToHead by opponent pair id (player stats)
// ---------------------------------------------------------------------------
describe("computePlayerStats — headToHead by opponent pair", () => {
  const pairs = [makePair(PAIR_XY, PLAYER_X, PLAYER_Y)];

  const m1 = makeMatch({
    pair_a_id: PAIR_XY,
    pair_b_id: PAIR_OP1,
    games: [{ a: 21, b: 15 }, { a: 21, b: 10 }], // W vs OP1
  });
  const m2 = makeMatch({
    pair_a_id: PAIR_OP1,
    pair_b_id: PAIR_XY,
    games: [{ a: 21, b: 10 }, { a: 21, b: 10 }], // L vs OP1 (XY is sideB, OP1 wins)
  });
  const m3 = makeMatch({
    pair_a_id: PAIR_XY,
    pair_b_id: PAIR_OP2,
    games: [{ a: 21, b: 15 }, { a: 21, b: 15 }], // W vs OP2
  });

  it("groups h2h by opponent pair id", () => {
    const stats = computePlayerStats({ playerId: PLAYER_X, pairs, matches: [m1, m2, m3] });
    const vsOp1 = stats.headToHead[PAIR_OP1];
    expect(vsOp1?.played).toBe(2);
    expect(vsOp1?.wins).toBe(1);
    expect(vsOp1?.losses).toBe(1);

    const vsOp2 = stats.headToHead[PAIR_OP2];
    expect(vsOp2?.played).toBe(1);
    expect(vsOp2?.wins).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 14. Non-completed matches excluded
// ---------------------------------------------------------------------------
describe("computePlayerStats — ignores non-completed matches", () => {
  it("ignores pending and in_progress", () => {
    const pairs = [makePair(PAIR_XY, PLAYER_X, PLAYER_Y)];
    const m1 = makeMatch({
      pair_a_id: PAIR_XY,
      pair_b_id: PAIR_OP1,
      games: [{ a: 21, b: 10 }],
      status: "pending",
    });
    const m2 = makeMatch({
      pair_a_id: PAIR_XY,
      pair_b_id: PAIR_OP1,
      games: [{ a: 21, b: 10 }],
      status: "in_progress",
    });
    const stats = computePlayerStats({ playerId: PLAYER_X, pairs, matches: [m1, m2] });
    expect(stats.played).toBe(0);
    expect(stats.matches).toHaveLength(0);
  });
});

// ===========================================================================
// computeTeamStats
// ===========================================================================

const TEAM_A = "team-alpha";
const TEAM_B = "team-beta";
const TEAM_C = "team-gamma";

// Pairs: TA1 + TA2 belong to TEAM_A; TB1 belongs to TEAM_B; TC1 belongs to TEAM_C
const TA1 = "pair-ta1";
const TA2 = "pair-ta2";
const TB1 = "pair-tb1";
const TC1 = "pair-tc1";

function makeTeamPair(id: string, teamId: string): PairWithPlayers {
  return {
    id,
    team_id: teamId,
    player_id_1: `player-${id}-1`,
    player_id_2: `player-${id}-2`,
    display_pair_name: null,
    pair_level: null,
    created_at: "2026-01-01T00:00:00Z",
    player1: makePlayer(`player-${id}-1`),
    player2: makePlayer(`player-${id}-2`),
  };
}

const teamPairs = [
  makeTeamPair(TA1, TEAM_A),
  makeTeamPair(TA2, TEAM_A),
  makeTeamPair(TB1, TEAM_B),
  makeTeamPair(TC1, TEAM_C),
];

// ---------------------------------------------------------------------------
// 15. computeTeamStats — 0 matches
// ---------------------------------------------------------------------------
describe("computeTeamStats — 0 matches", () => {
  it("returns zeroed stats for team with no matches", () => {
    const stats = computeTeamStats({ teamId: TEAM_A, pairs: teamPairs, matches: [] });
    expect(stats.entityType).toBe("team");
    expect(stats.entityId).toBe(TEAM_A);
    expect(stats.played).toBe(0);
    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(0);
    expect(stats.draws).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(Object.keys(stats.headToHead)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 16. computeTeamStats — aggregates across multiple team pairs
// ---------------------------------------------------------------------------
describe("computeTeamStats — aggregates across multiple team pairs", () => {
  // TA1 wins vs TB1
  const m1 = makeMatch({
    pair_a_id: TA1,
    pair_b_id: TB1,
    games: [{ a: 21, b: 15 }, { a: 21, b: 10 }], // TEAM_A wins
  });
  // TA2 loses vs TC1
  const m2 = makeMatch({
    pair_a_id: TA2,
    pair_b_id: TC1,
    games: [{ a: 10, b: 21 }, { a: 15, b: 21 }], // TEAM_A loses
  });
  // TA1 wins vs TC1 (side B — TC1 is side A, TA1 is side B → TA1 wins)
  const m3 = makeMatch({
    pair_a_id: TC1,
    pair_b_id: TA1,
    games: [{ a: 10, b: 21 }, { a: 10, b: 21 }], // side B wins → TEAM_A wins
  });

  it("counts wins and losses across all team pairs", () => {
    const stats = computeTeamStats({ teamId: TEAM_A, pairs: teamPairs, matches: [m1, m2, m3] });
    expect(stats.played).toBe(3);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.draws).toBe(0);
  });

  it("win rate is 2/3", () => {
    const stats = computeTeamStats({ teamId: TEAM_A, pairs: teamPairs, matches: [m1, m2, m3] });
    expect(stats.winRate).toBeCloseTo(2 / 3);
  });

  it("aggregates points correctly across pairs", () => {
    const stats = computeTeamStats({ teamId: TEAM_A, pairs: teamPairs, matches: [m1, m2, m3] });
    // m1 (TA1 side A): for=42, against=25
    // m2 (TA2 side A): for=25, against=42
    // m3 (TA1 side B): for=21+21=42, against=10+10=20
    expect(stats.pointsFor).toBe(42 + 25 + 42);
    expect(stats.pointsAgainst).toBe(25 + 42 + 20);
  });
});

// ---------------------------------------------------------------------------
// 17. computeTeamStats — headToHead keyed by opponent team id
// ---------------------------------------------------------------------------
describe("computeTeamStats — headToHead by opponent team", () => {
  const m1 = makeMatch({
    pair_a_id: TA1,
    pair_b_id: TB1,
    games: [{ a: 21, b: 15 }, { a: 21, b: 10 }], // TEAM_A wins vs TEAM_B
  });
  const m2 = makeMatch({
    pair_a_id: TA1,
    pair_b_id: TB1,
    games: [{ a: 10, b: 21 }, { a: 10, b: 21 }], // TEAM_A loses vs TEAM_B
  });
  const m3 = makeMatch({
    pair_a_id: TA2,
    pair_b_id: TC1,
    games: [{ a: 21, b: 10 }, { a: 21, b: 15 }], // TEAM_A wins vs TEAM_C
  });

  it("groups h2h by opponent team id (not pair id)", () => {
    const stats = computeTeamStats({ teamId: TEAM_A, pairs: teamPairs, matches: [m1, m2, m3] });
    const vsB = stats.headToHead[TEAM_B];
    expect(vsB).toBeDefined();
    expect(vsB!.played).toBe(2);
    expect(vsB!.wins).toBe(1);
    expect(vsB!.losses).toBe(1);

    const vsC = stats.headToHead[TEAM_C];
    expect(vsC).toBeDefined();
    expect(vsC!.played).toBe(1);
    expect(vsC!.wins).toBe(1);
  });

  it("does not include self-team id in headToHead keys", () => {
    const stats = computeTeamStats({ teamId: TEAM_A, pairs: teamPairs, matches: [m1, m2, m3] });
    expect(stats.headToHead[TEAM_A]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 18. computeTeamStats — intra-team matches are excluded
// ---------------------------------------------------------------------------
describe("computeTeamStats — excludes intra-team matches", () => {
  it("does not count match where both pairs belong to same team", () => {
    const intraMatch = makeMatch({
      pair_a_id: TA1,
      pair_b_id: TA2,
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
    });
    const stats = computeTeamStats({
      teamId: TEAM_A,
      pairs: teamPairs,
      matches: [intraMatch],
    });
    expect(stats.played).toBe(0);
    expect(Object.keys(stats.headToHead)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 19. computeTeamStats — non-completed matches excluded
// ---------------------------------------------------------------------------
describe("computeTeamStats — ignores non-completed", () => {
  it("ignores pending and in_progress matches", () => {
    const m1 = makeMatch({
      pair_a_id: TA1,
      pair_b_id: TB1,
      games: [{ a: 21, b: 10 }],
      status: "pending",
    });
    const stats = computeTeamStats({ teamId: TEAM_A, pairs: teamPairs, matches: [m1] });
    expect(stats.played).toBe(0);
  });
});

// ===========================================================================
// computeDivisionStats
// ===========================================================================

const DIV_PAIR_1 = "div-pair-1";
const DIV_PAIR_2 = "div-pair-2";
const DIV_PAIR_3 = "div-pair-3";

// thresholds [5] → Division 1 = pair_level > 5, Division 2 = pair_level ≤ 5
const THRESHOLDS_1 = [5];

function makeDivPair(id: string, level: string): PairWithPlayers {
  return {
    id,
    team_id: TEAM_A,
    player_id_1: `p1-${id}`,
    player_id_2: `p2-${id}`,
    display_pair_name: null,
    pair_level: level,
    created_at: "2026-01-01T00:00:00Z",
    player1: makePlayer(`p1-${id}`),
    player2: makePlayer(`p2-${id}`),
  };
}

// DIV_PAIR_1 and DIV_PAIR_2 have level 7 → Division 1 (> threshold 5)
// DIV_PAIR_3 has level 4 → Division 2 (≤ threshold 5)
const divPairs = [
  makeDivPair(DIV_PAIR_1, "7"),
  makeDivPair(DIV_PAIR_2, "7"),
  makeDivPair(DIV_PAIR_3, "4"),
];

// ---------------------------------------------------------------------------
// 20. computeDivisionStats — 0 matches → empty
// ---------------------------------------------------------------------------
describe("computeDivisionStats — 0 matches", () => {
  it("returns zeroed stats when no matches in division", () => {
    const stats = computeDivisionStats({
      division: 1,
      pairs: divPairs,
      matches: [],
      thresholds: THRESHOLDS_1,
    });
    expect(stats.entityType).toBe("division");
    expect(stats.entityId).toBe("1");
    expect(stats.played).toBe(0);
    expect(stats.pointsFor).toBe(0);
    expect(stats.pointsAgainst).toBe(0);
    expect(Object.keys(stats.headToHead)).toHaveLength(0);
    expect(stats.streak).toEqual({ type: null, length: 0 });
  });
});

// ---------------------------------------------------------------------------
// 21. computeDivisionStats — filters by division column
// ---------------------------------------------------------------------------
describe("computeDivisionStats — filters by division column", () => {
  // m1 is division "1", m2 is division "2", m3 has no division
  const m1 = makeMatch({
    pair_a_id: DIV_PAIR_1,
    pair_b_id: DIV_PAIR_2,
    games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
    division: "1",
  });
  const m2 = makeMatch({
    pair_a_id: DIV_PAIR_3,
    pair_b_id: DIV_PAIR_1,
    games: [{ a: 15, b: 21 }, { a: 10, b: 21 }],
    division: "2",
  });
  const m3 = makeMatch({
    pair_a_id: DIV_PAIR_1,
    pair_b_id: DIV_PAIR_2,
    games: [{ a: 21, b: 18 }],
    division: null,
  });

  it("counts only division-1 matches when querying division 1", () => {
    const stats = computeDivisionStats({
      division: 1,
      pairs: divPairs,
      matches: [m1, m2, m3],
      thresholds: THRESHOLDS_1,
    });
    expect(stats.played).toBe(1);
    expect(stats.matches).toHaveLength(1);
    expect(stats.matches[0].id).toBe(m1.id);
  });

  it("counts only division-2 matches when querying division 2", () => {
    const stats = computeDivisionStats({
      division: 2,
      pairs: divPairs,
      matches: [m1, m2, m3],
      thresholds: THRESHOLDS_1,
    });
    expect(stats.played).toBe(1);
    expect(stats.matches[0].id).toBe(m2.id);
  });
});

// ---------------------------------------------------------------------------
// 22. computeDivisionStats — per-pair headToHead standings
// ---------------------------------------------------------------------------
describe("computeDivisionStats — headToHead is per-pair standings", () => {
  const m1 = makeMatch({
    pair_a_id: DIV_PAIR_1,
    pair_b_id: DIV_PAIR_2,
    games: [{ a: 21, b: 15 }, { a: 21, b: 10 }], // DIV_PAIR_1 wins
    division: "1",
  });
  const m2 = makeMatch({
    pair_a_id: DIV_PAIR_2,
    pair_b_id: DIV_PAIR_1,
    games: [{ a: 21, b: 10 }, { a: 21, b: 10 }], // DIV_PAIR_2 wins
    division: "1",
  });

  it("records per-pair wins/losses in headToHead map", () => {
    const stats = computeDivisionStats({
      division: 1,
      pairs: divPairs,
      matches: [m1, m2],
      thresholds: THRESHOLDS_1,
    });
    const p1 = stats.headToHead[DIV_PAIR_1];
    const p2 = stats.headToHead[DIV_PAIR_2];
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(p1!.played).toBe(2);
    expect(p1!.wins).toBe(1);
    expect(p1!.losses).toBe(1);
    expect(p2!.played).toBe(2);
    expect(p2!.wins).toBe(1);
    expect(p2!.losses).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 23. computeDivisionStats — pointsFor/pointsAgainst are raw side-A totals
// ---------------------------------------------------------------------------
describe("computeDivisionStats — points aggregation", () => {
  it("sums side-A and side-B points correctly across matches", () => {
    const m1 = makeMatch({
      pair_a_id: DIV_PAIR_1,
      pair_b_id: DIV_PAIR_2,
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
      division: "1",
    });
    const m2 = makeMatch({
      pair_a_id: DIV_PAIR_2,
      pair_b_id: DIV_PAIR_1,
      games: [{ a: 18, b: 21 }, { a: 14, b: 21 }],
      division: "1",
    });
    const stats = computeDivisionStats({
      division: 1,
      pairs: divPairs,
      matches: [m1, m2],
      thresholds: THRESHOLDS_1,
    });
    // m1: sideA=42, sideB=25 → pointsFor+=42, pointsAgainst+=25
    // m2: sideA=32, sideB=42 → pointsFor+=32, pointsAgainst+=42
    expect(stats.pointsFor).toBe(42 + 32);
    expect(stats.pointsAgainst).toBe(25 + 42);
  });
});

// ---------------------------------------------------------------------------
// 24. computeDivisionStats — non-completed matches excluded
// ---------------------------------------------------------------------------
describe("computeDivisionStats — ignores non-completed", () => {
  it("ignores pending matches even if division column matches", () => {
    const m = makeMatch({
      pair_a_id: DIV_PAIR_1,
      pair_b_id: DIV_PAIR_2,
      games: [{ a: 21, b: 10 }],
      division: "1",
      status: "pending",
    });
    const stats = computeDivisionStats({
      division: 1,
      pairs: divPairs,
      matches: [m],
      thresholds: THRESHOLDS_1,
    });
    expect(stats.played).toBe(0);
    expect(Object.keys(stats.headToHead)).toHaveLength(0);
  });
});

// ===========================================================================
// BYE-match regression (P1, 2026-05-24)
// gameWinner([]) returns "draw"; BYE walkovers are `status=completed` with
// `games=[]`. They must NOT count as draws / not bleed into streaks.
// ===========================================================================

describe("computePairStats — BYE matches (games=[]) are not counted", () => {
  it("1 BYE → played=0, draws=0, streak={null,0}", () => {
    const bye = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: null,
      games: [],
    });
    const stats = computePairStats({ pairId: PAIR_A, matches: [bye] });
    expect(stats.played).toBe(0);
    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(0);
    expect(stats.draws).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.matches).toHaveLength(0);
    expect(Object.keys(stats.headToHead)).toHaveLength(0);
    expect(stats.streak).toEqual({ type: null, length: 0 });
  });
});

describe("computePlayerStats — BYE matches (games=[]) are not counted", () => {
  it("1 BYE for the player's pair → played=0, draws=0, streak={null,0}", () => {
    const pairs = [makePair(PAIR_XY, PLAYER_X, PLAYER_Y)];
    const bye = makeMatch({
      pair_a_id: PAIR_XY,
      pair_b_id: null,
      games: [],
    });
    const stats = computePlayerStats({
      playerId: PLAYER_X,
      pairs,
      matches: [bye],
    });
    expect(stats.played).toBe(0);
    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(0);
    expect(stats.draws).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.matches).toHaveLength(0);
    expect(Object.keys(stats.headToHead)).toHaveLength(0);
    expect(Object.keys(stats.partnerBreakdown)).toHaveLength(0);
    expect(stats.streak).toEqual({ type: null, length: 0 });
  });
});

describe("computeTeamStats — BYE matches (games=[]) are not counted", () => {
  it("1 BYE for one of the team's pairs → played=0, draws=0, streak={null,0}", () => {
    const bye = makeMatch({
      pair_a_id: TA1, // belongs to TEAM_A
      pair_b_id: null,
      games: [],
    });
    const stats = computeTeamStats({
      teamId: TEAM_A,
      pairs: teamPairs,
      matches: [bye],
    });
    expect(stats.played).toBe(0);
    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(0);
    expect(stats.draws).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.matches).toHaveLength(0);
    expect(Object.keys(stats.headToHead)).toHaveLength(0);
    expect(stats.streak).toEqual({ type: null, length: 0 });
  });
});

// ===========================================================================
// Regression tests for code-review findings #1, #2, #7, #9 (2026-05-24)
// ===========================================================================

// ---------------------------------------------------------------------------
// #1 — computeDivisionStats: cross-bucketed matches MUST NOT leak in
// ---------------------------------------------------------------------------
describe("computeDivisionStats — cross-bucketed matches don't leak (#1)", () => {
  it("excludes a match stamped division='1' whose pairs both live in Division 2", () => {
    // Build pairs: only DIV_PAIR_1 is in division 1 (level 7 > threshold 5).
    // DIV_PAIR_2 (level 4) and DIV_PAIR_3 (level 3) both live in division 2.
    const skewedPairs = [
      makeDivPair(DIV_PAIR_1, "7"),
      makeDivPair(DIV_PAIR_2, "4"),
      makeDivPair(DIV_PAIR_3, "3"),
    ];
    // Misstamped match: marked division="1" but pairs belong to division 2.
    const leak = makeMatch({
      pair_a_id: DIV_PAIR_2,
      pair_b_id: DIV_PAIR_3,
      games: [{ a: 21, b: 18 }],
      division: "1",
    });
    // Genuine division-1 match (DIV_PAIR_1 has nobody to play, but still
    // contributes a side and we want the cross-bucketed leak to be filtered).
    const stats = computeDivisionStats({
      division: 1,
      pairs: skewedPairs,
      matches: [leak],
      thresholds: THRESHOLDS_1,
    });
    expect(stats.played).toBe(0);
    expect(stats.matches).toHaveLength(0);
    expect(stats.headToHead[DIV_PAIR_2]).toBeUndefined();
    expect(stats.headToHead[DIV_PAIR_3]).toBeUndefined();
  });

  it("keeps a match where one side is in-division (defensive boundary)", () => {
    const mixed = makeMatch({
      pair_a_id: DIV_PAIR_1, // in division 1
      pair_b_id: DIV_PAIR_3, // mis-bucketed pair (level 3 → division 2)
      games: [{ a: 21, b: 10 }, { a: 21, b: 15 }],
      division: "1",
    });
    const skewedPairs = [
      makeDivPair(DIV_PAIR_1, "7"),
      makeDivPair(DIV_PAIR_3, "3"),
    ];
    const stats = computeDivisionStats({
      division: 1,
      pairs: skewedPairs,
      matches: [mixed],
      thresholds: THRESHOLDS_1,
    });
    expect(stats.played).toBe(1);
    // DIV_PAIR_1 (in-division) gets standings entry; DIV_PAIR_3 does NOT
    expect(stats.headToHead[DIV_PAIR_1]).toBeDefined();
    expect(stats.headToHead[DIV_PAIR_3]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #2 — computeDivisionStats: winRate pinned to 0 (meaningless at aggregate)
// ---------------------------------------------------------------------------
describe("computeDivisionStats — winRate is 0 (#2)", () => {
  it("returns winRate=0 even when matches are played (decisive)", () => {
    const m1 = makeMatch({
      pair_a_id: DIV_PAIR_1,
      pair_b_id: DIV_PAIR_2,
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
      division: "1",
    });
    const stats = computeDivisionStats({
      division: 1,
      pairs: divPairs,
      matches: [m1],
      thresholds: THRESHOLDS_1,
    });
    expect(stats.played).toBe(1);
    expect(stats.winRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #7 — computeTeamStats: intra-team matches filtered consistently
// (relevant + matches + streak agree with W/L/D counts)
// ---------------------------------------------------------------------------
describe("computeTeamStats — intra-team filter consistency (#7)", () => {
  it("intra-team match is absent from stats.matches AND streak", () => {
    const intra = makeMatch({
      pair_a_id: TA1,
      pair_b_id: TA2, // both TEAM_A
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
    });
    const inter = makeMatch({
      pair_a_id: TA1,
      pair_b_id: TB1, // TEAM_A vs TEAM_B — kept
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
    });
    const stats = computeTeamStats({
      teamId: TEAM_A,
      pairs: teamPairs,
      matches: [intra, inter],
    });
    expect(stats.played).toBe(1);
    expect(stats.matches).toHaveLength(1);
    expect(stats.matches[0].id).toBe(inter.id);
    // Streak reflects ONLY the inter-team win, not the intra match.
    expect(stats.streak).toEqual({ type: "W", length: 1 });
  });
});

// ---------------------------------------------------------------------------
// #9 — computePlayerStats: player in BOTH sides of same match is skipped
// ---------------------------------------------------------------------------
describe("computePlayerStats — both-sides anomaly is skipped (#9)", () => {
  it("excludes matches where the player belongs to pair_a AND pair_b", () => {
    // PLAYER_X is in pair_xy AND pair_xz; m1 pits them against each other.
    const pairs = [
      makePair(PAIR_XY, PLAYER_X, PLAYER_Y),
      makePair(PAIR_XZ, PLAYER_X, PLAYER_Z),
    ];
    const both = makeMatch({
      pair_a_id: PAIR_XY,
      pair_b_id: PAIR_XZ,
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
    });
    const normal = makeMatch({
      pair_a_id: PAIR_XY,
      pair_b_id: PAIR_OP1,
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }], // X wins
    });
    const stats = computePlayerStats({
      playerId: PLAYER_X,
      pairs,
      matches: [both, normal],
    });
    expect(stats.played).toBe(1);
    expect(stats.matches).toHaveLength(1);
    expect(stats.matches[0].id).toBe(normal.id);
    expect(stats.wins).toBe(1);
    expect(stats.draws).toBe(0);
  });
});

describe("computeDivisionStats — BYE matches (games=[]) are not counted", () => {
  it("1 BYE in division 1 → played=0, no headToHead entries, no points", () => {
    const bye = makeMatch({
      pair_a_id: DIV_PAIR_1,
      pair_b_id: null,
      games: [],
      division: "1",
    });
    const stats = computeDivisionStats({
      division: 1,
      pairs: divPairs,
      matches: [bye],
      thresholds: THRESHOLDS_1,
    });
    expect(stats.played).toBe(0);
    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(0);
    expect(stats.draws).toBe(0);
    expect(stats.pointsFor).toBe(0);
    expect(stats.pointsAgainst).toBe(0);
    expect(stats.matches).toHaveLength(0);
    expect(Object.keys(stats.headToHead)).toHaveLength(0);
  });
});
