import { describe, it, expect } from "vitest";
import { computePairStats, computePlayerStats } from "../entity-stats";
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
    expect(stats.headToHead.size).toBe(0);
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
    expect(stats.headToHead.size).toBe(0);
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

    const vsB = stats.headToHead.get(PAIR_B);
    expect(vsB).toBeDefined();
    expect(vsB!.played).toBe(2);
    expect(vsB!.wins).toBe(1);
    expect(vsB!.losses).toBe(1);
    expect(vsB!.draws).toBe(0);

    const vsC = stats.headToHead.get(PAIR_C);
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
    expect(stats.headToHead.size).toBe(0);
    expect(stats.partnerBreakdown?.size).toBe(0);
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
    expect(stats.headToHead.has(PAIR_OP1)).toBe(true);
    expect(stats.headToHead.has(PAIR_OP2)).toBe(true);
    expect(stats.headToHead.get(PAIR_OP1)?.wins).toBe(1);
    expect(stats.headToHead.get(PAIR_OP2)?.losses).toBe(1);
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
    const withY = stats.partnerBreakdown?.get(PLAYER_Y);
    expect(withY).toBeDefined();
    expect(withY!.played).toBe(2);
    expect(withY!.wins).toBe(1);
    expect(withY!.losses).toBe(1);
    expect(withY!.draws).toBe(0);
  });

  it("tracks partner W: 1 played, 1W", () => {
    const stats = computePlayerStats({ playerId: PLAYER_X, pairs, matches: [m1, m2, m3] });
    const withW = stats.partnerBreakdown?.get(PLAYER_W);
    expect(withW).toBeDefined();
    expect(withW!.played).toBe(1);
    expect(withW!.wins).toBe(1);
  });

  it("partnerBreakdown has exactly 2 partners", () => {
    const stats = computePlayerStats({ playerId: PLAYER_X, pairs, matches: [m1, m2, m3] });
    expect(stats.partnerBreakdown?.size).toBe(2);
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
    const vsOp1 = stats.headToHead.get(PAIR_OP1);
    expect(vsOp1?.played).toBe(2);
    expect(vsOp1?.wins).toBe(1);
    expect(vsOp1?.losses).toBe(1);

    const vsOp2 = stats.headToHead.get(PAIR_OP2);
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
