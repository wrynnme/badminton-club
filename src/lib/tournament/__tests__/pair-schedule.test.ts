import { describe, it, expect } from "vitest";
import { partitionPairMatches } from "../pair-schedule";
import type { Match, Game } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helper — build a minimal Match. match_number auto-increments unless overridden.
// ---------------------------------------------------------------------------
let _matchCounter = 0;
function makeMatch(overrides: Partial<Match> & { games: Game[] }): Match {
  _matchCounter++;
  return {
    id: `m${_matchCounter}`,
    tournament_id: "t1",
    group_id: null,
    class_id: null,
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
// (a) BYE (status completed, games=[]) EXCLUDED from completed
// ---------------------------------------------------------------------------
describe("partitionPairMatches — BYE exclusion", () => {
  it("excludes a completed BYE (games=[]) from the completed bucket", () => {
    const bye = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: null,
      games: [],
      status: "completed",
    });
    const real = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: PAIR_B,
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
      status: "completed",
    });
    const { inProgress, pending, completed } = partitionPairMatches([bye, real], PAIR_A);
    expect(inProgress).toHaveLength(0);
    expect(pending).toHaveLength(0);
    expect(completed).toHaveLength(1);
    expect(completed[0].id).toBe(real.id);
  });
});

// ---------------------------------------------------------------------------
// (b) pending sorted by queue_position when set, falling back to match_number
// ---------------------------------------------------------------------------
describe("partitionPairMatches — pending sort order", () => {
  it("sorts pending by queue_position when set", () => {
    // Insert in scrambled order; expect ascending queue_position.
    const m1 = makeMatch({ pair_a_id: PAIR_A, pair_b_id: PAIR_B, games: [], status: "pending", queue_position: 5 });
    const m2 = makeMatch({ pair_a_id: PAIR_A, pair_b_id: PAIR_C, games: [], status: "pending", queue_position: 1 });
    const m3 = makeMatch({ pair_a_id: PAIR_A, pair_b_id: PAIR_B, games: [], status: "pending", queue_position: 3 });
    const { pending } = partitionPairMatches([m1, m2, m3], PAIR_A);
    expect(pending.map((m) => m.id)).toEqual([m2.id, m3.id, m1.id]);
  });

  it("falls back to match_number when queue_position is null", () => {
    // queue_position null → use match_number. Build with explicit match_numbers.
    const high = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: PAIR_B,
      games: [],
      status: "pending",
      queue_position: null,
      match_number: 99,
    });
    const low = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: PAIR_C,
      games: [],
      status: "pending",
      queue_position: null,
      match_number: 7,
    });
    const { pending } = partitionPairMatches([high, low], PAIR_A);
    expect(pending.map((m) => m.id)).toEqual([low.id, high.id]);
  });
});

// ---------------------------------------------------------------------------
// (c) pair with zero matches → all three arrays empty
// ---------------------------------------------------------------------------
describe("partitionPairMatches — pair with no matches", () => {
  it("returns three empty arrays when the pair plays nothing", () => {
    const { inProgress, pending, completed } = partitionPairMatches([], PAIR_A);
    expect(inProgress).toHaveLength(0);
    expect(pending).toHaveLength(0);
    expect(completed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (d) a match where the pair is on side B (pair_b_id === pairId) is included
// ---------------------------------------------------------------------------
describe("partitionPairMatches — pair on side B", () => {
  it("includes a match where pairId sits on pair_b_id", () => {
    const m = makeMatch({
      pair_a_id: PAIR_B,
      pair_b_id: PAIR_A,
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
      status: "completed",
    });
    const { completed } = partitionPairMatches([m], PAIR_A);
    expect(completed).toHaveLength(1);
    expect(completed[0].id).toBe(m.id);
  });
});

// ---------------------------------------------------------------------------
// (e) in_progress + pending + completed all partitioned correctly in one mixed input
// ---------------------------------------------------------------------------
describe("partitionPairMatches — mixed statuses", () => {
  it("partitions a mixed input into the correct buckets", () => {
    const live = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: PAIR_B,
      games: [{ a: 11, b: 9 }],
      status: "in_progress",
    });
    const queued = makeMatch({
      pair_a_id: PAIR_C,
      pair_b_id: PAIR_A,
      games: [],
      status: "pending",
      queue_position: 2,
    });
    const done = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: PAIR_B,
      games: [{ a: 21, b: 18 }, { a: 21, b: 12 }],
      status: "completed",
    });
    const byeDone = makeMatch({
      pair_a_id: PAIR_A,
      pair_b_id: null,
      games: [],
      status: "completed",
    });

    const { inProgress, pending, completed } = partitionPairMatches(
      [done, live, byeDone, queued],
      PAIR_A,
    );

    expect(inProgress.map((m) => m.id)).toEqual([live.id]);
    expect(pending.map((m) => m.id)).toEqual([queued.id]);
    expect(completed.map((m) => m.id)).toEqual([done.id]); // byeDone excluded
  });
});

// ---------------------------------------------------------------------------
// (f) a match belonging to a DIFFERENT pair is excluded from all three
// ---------------------------------------------------------------------------
describe("partitionPairMatches — unrelated pair excluded", () => {
  it("excludes a match between two other pairs from every bucket", () => {
    const other = makeMatch({
      pair_a_id: PAIR_B,
      pair_b_id: PAIR_C,
      games: [{ a: 21, b: 15 }, { a: 21, b: 10 }],
      status: "completed",
    });
    const otherPending = makeMatch({
      pair_a_id: PAIR_B,
      pair_b_id: PAIR_C,
      games: [],
      status: "pending",
      queue_position: 1,
    });
    const otherLive = makeMatch({
      pair_a_id: PAIR_B,
      pair_b_id: PAIR_C,
      games: [{ a: 5, b: 3 }],
      status: "in_progress",
    });
    const { inProgress, pending, completed } = partitionPairMatches(
      [other, otherPending, otherLive],
      PAIR_A,
    );
    expect(inProgress).toHaveLength(0);
    expect(pending).toHaveLength(0);
    expect(completed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Purity — input array is not mutated (order preserved)
// ---------------------------------------------------------------------------
describe("partitionPairMatches — does not mutate input", () => {
  it("leaves the caller's array order untouched", () => {
    const m1 = makeMatch({ pair_a_id: PAIR_A, pair_b_id: PAIR_B, games: [], status: "pending", queue_position: 9 });
    const m2 = makeMatch({ pair_a_id: PAIR_A, pair_b_id: PAIR_C, games: [], status: "pending", queue_position: 1 });
    const input = [m1, m2];
    partitionPairMatches(input, PAIR_A);
    expect(input.map((m) => m.id)).toEqual([m1.id, m2.id]);
  });
});
