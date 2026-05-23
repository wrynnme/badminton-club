import { describe, it, expect } from "vitest";
import { computePairStats } from "../entity-stats";
import type { Match, Game } from "@/lib/types";

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
