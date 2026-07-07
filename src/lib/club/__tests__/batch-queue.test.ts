import { describe, it, expect } from "vitest";
import {
  resolvePlayerWindow,
  computePlayerTarget,
  proRatedTarget,
  countFixedAppearances,
  buildPairHistory,
  generateBatchQueue,
  planRerollSwap,
  type BatchMatchPlan,
  type BatchCountableMatch,
  type RerollSwapMatch,
} from "../batch-queue";
import { pairKey } from "../pair-history";
import { DEFAULT_QUEUE_SETTINGS, type ClubQueueSettings } from "../queue-settings";
import type { QueuePlayer } from "../queue";

function mkPlayer(id: string, overrides: Partial<QueuePlayer> = {}): QueuePlayer {
  return {
    id,
    position: null,
    joined_at: `2026-07-07T10:00:00.000Z`,
    level: null,
    games_played: 0,
    last_finished_at: null,
    ...overrides,
  };
}

function settings(overrides: Partial<ClubQueueSettings> = {}): ClubQueueSettings {
  return { ...DEFAULT_QUEUE_SETTINGS, ...overrides };
}

function remainingAll(pool: QueuePlayer[], n: number): Map<string, number> {
  return new Map(pool.map((p) => [p.id, n]));
}

/** fixed-slot ids of a plan (winnerOf sides contribute nothing) */
function fixedIds(plan: BatchMatchPlan): string[] {
  const out: string[] = [];
  for (const side of [plan.sideA, plan.sideB]) {
    if (side.kind === "players") {
      out.push(side.player1);
      if (side.player2) out.push(side.player2);
    }
  }
  return out;
}

function appearanceCounts(plans: BatchMatchPlan[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const plan of plans) {
    for (const id of fixedIds(plan)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** every non-winnerOf side must be completely staffed for the given ppt */
function assertNoPartialSides(plans: BatchMatchPlan[], ppt: 1 | 2) {
  for (const plan of plans) {
    for (const side of [plan.sideA, plan.sideB]) {
      if (side.kind !== "players") continue;
      expect(side.player1).toBeTruthy();
      if (ppt === 2) expect(side.player2).toBeTruthy();
      else expect(side.player2).toBeNull();
    }
  }
}

/**
 * Every player who could occupy a plan side AT RUNTIME: fixed slots as-is; a
 * winnerOf slot resolves to the full set of its source match's possible occupants
 * (recursively — promotion fills it with an unknown 2 of them). Memoised;
 * sourceIndex always points at an earlier plan so the walk is a finite DAG.
 */
function sideOccupants(
  plans: BatchMatchPlan[],
  side: BatchMatchPlan["sideA"],
  memo: Map<number, Set<string>>,
): Set<string> {
  if (side.kind === "players") {
    const s = new Set<string>();
    s.add(side.player1);
    if (side.player2) s.add(side.player2);
    return s;
  }
  return matchOccupants(plans, side.sourceIndex, memo);
}

function matchOccupants(
  plans: BatchMatchPlan[],
  index: number,
  memo: Map<number, Set<string>>,
): Set<string> {
  const cached = memo.get(index);
  if (cached) return cached;
  const acc = new Set<string>();
  memo.set(index, acc); // set before recursing — sourceIndex is always earlier, no cycle
  for (const id of sideOccupants(plans, plans[index].sideA, memo)) acc.add(id);
  for (const id of sideOccupants(plans, plans[index].sideB, memo)) acc.add(id);
  return acc;
}

/**
 * Reconstruct concurrent rounds from a lane-mode plan list (a lane index that
 * does not increase marks the next round) and assert no double-book, judged on
 * POSSIBLE OCCUPANTS not just fixed ids: a winnerOf slot is filled at runtime by
 * an unknown 2 of its source match's occupants, so the safe invariant is that
 * (1) a match's two sides can never share a possible occupant (else P-vs-P after
 * promotion) and (2) two matches in the same round can never share one (else the
 * same player lands on two courts once winners are promoted). Disjoint possible
 * occupants ⇒ no double-book for ANY winner outcome. (Fair mode: lane=null → each
 * plan its own round → trivially ok.)
 */
function assertNoConcurrentDoubleBooking(plans: BatchMatchPlan[]) {
  const rounds: number[][] = [];
  let cur: number[] = [];
  let lastLane = -1;
  plans.forEach((plan, i) => {
    const lane = plan.lane ?? 0;
    if (lane <= lastLane) {
      if (cur.length) rounds.push(cur);
      cur = [];
    }
    cur.push(i);
    lastLane = lane;
  });
  if (cur.length) rounds.push(cur);

  const memo = new Map<number, Set<string>>();
  rounds.forEach((round, r) => {
    // (1) no player on both sides of the same match
    for (const i of round) {
      const a = sideOccupants(plans, plans[i].sideA, memo);
      const b = sideOccupants(plans, plans[i].sideB, memo);
      for (const id of a) {
        expect(b.has(id), `player ${id} could face itself (P-vs-P) in round ${r}`).toBe(false);
      }
    }
    // (2) no player can occupy two concurrent courts this round
    const seen = new Map<string, number>();
    for (const i of round) {
      for (const id of matchOccupants(plans, i, memo)) {
        const prev = seen.get(id);
        expect(
          prev === undefined || prev === i,
          `player ${id} could occupy two concurrent courts in round ${r}`,
        ).toBe(true);
        seen.set(id, i);
      }
    }
  });
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));

describe("resolvePlayerWindow", () => {
  const base = { clubStart: "18:00", clubEnd: "22:00" };

  it("declared start/end win over check-in and club window", () => {
    expect(
      resolvePlayerWindow({
        declaredStart: "19:00",
        declaredEnd: "21:00",
        checkedInHHMM: "18:30",
        ...base,
      }),
    ).toEqual({ start: "19:00", end: "21:00" });
  });

  it("falls back to check-in time, then club window", () => {
    expect(
      resolvePlayerWindow({ declaredStart: null, declaredEnd: null, checkedInHHMM: "20:00", ...base }),
    ).toEqual({ start: "20:00", end: "22:00" });
    expect(
      resolvePlayerWindow({ declaredStart: null, declaredEnd: null, checkedInHHMM: null, ...base }),
    ).toEqual({ start: "18:00", end: "22:00" });
  });

  it("blank strings are treated as absent", () => {
    expect(
      resolvePlayerWindow({ declaredStart: " ", declaredEnd: "", checkedInHHMM: null, ...base }),
    ).toEqual({ start: "18:00", end: "22:00" });
  });
});

describe("computePlayerTarget / proRatedTarget", () => {
  it("full window keeps N; half window rounds; floor is 1", () => {
    expect(computePlayerTarget(5, 240, 240)).toBe(5);
    expect(computePlayerTarget(5, 120, 240)).toBe(3); // round(2.5) = 3
    expect(computePlayerTarget(4, 120, 240)).toBe(2);
    expect(computePlayerTarget(3, 10, 240)).toBe(1); // round(0.125)=0 → floor 1
  });

  it("degenerate session or over-long window clamps sanely", () => {
    expect(computePlayerTarget(5, 100, 0)).toBe(5); // no session length → full N
    expect(computePlayerTarget(5, 999, 240)).toBe(5); // fraction clamped to 1
  });

  it("proRatedTarget wires the session clamp (late arrival = half target)", () => {
    // 2h session 18:00–20:00; player declared 19:00 arrival → 1h of 2h → N/2
    expect(
      proRatedTarget(4, { start: "19:00", end: "20:00" }, "18:00", "20:00"),
    ).toBe(2);
  });
});

describe("countFixedAppearances", () => {
  it("counts pending + in_progress + completed, skips cancelled and null slots", () => {
    const rows: BatchCountableMatch[] = [
      { status: "completed", side_a_player1: "A", side_a_player2: "B", side_b_player1: "C", side_b_player2: "D" },
      { status: "in_progress", side_a_player1: "A", side_a_player2: null, side_b_player1: "E", side_b_player2: null },
      { status: "pending", side_a_player1: "B", side_a_player2: null, side_b_player1: null, side_b_player2: null },
      { status: "cancelled", side_a_player1: "A", side_a_player2: "B", side_b_player1: "C", side_b_player2: "D" },
    ];
    const counts = countFixedAppearances(rows);
    expect(counts.get("A")).toBe(2);
    expect(counts.get("B")).toBe(2);
    expect(counts.get("C")).toBe(1);
    expect(counts.get("E")).toBe(1);
  });
});

describe("generateBatchQueue — fair mode (doubles)", () => {
  it("8 players N=3 → exactly 6 full matches, everyone plays exactly 3", () => {
    const pool = ids(8).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: settings(),
      lockedPairs: [],
      remaining: remainingAll(pool, 3),
      laneCount: 2,
    });
    expect(plans).toHaveLength(6);
    assertNoPartialSides(plans, 2);
    const counts = appearanceCounts(plans);
    for (const p of pool) expect(counts.get(p.id)).toBe(3);
    for (const plan of plans) expect(plan.lane).toBeNull();
  });

  it("5 players N=2 → 3 matches, everyone ≥2, at most two players get the N+1 filler slot", () => {
    const pool = ids(5).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: settings(),
      lockedPairs: [],
      remaining: remainingAll(pool, 2),
      laneCount: 1,
    });
    expect(plans).toHaveLength(3);
    assertNoPartialSides(plans, 2);
    const counts = appearanceCounts(plans);
    let overTarget = 0;
    for (const p of pool) {
      const c = counts.get(p.id) ?? 0;
      expect(c).toBeGreaterThanOrEqual(2);
      if (c > 2) overTarget++;
    }
    expect(overTarget).toBeLessThanOrEqual(2);
  });

  it("top-up: zero remaining → no plans; feeding output back as existing → no more plans", () => {
    const pool = ids(8).map((id) => mkPlayer(id));
    expect(
      generateBatchQueue({
        pool,
        settings: settings(),
        lockedPairs: [],
        remaining: remainingAll(pool, 0),
        laneCount: 2,
      }),
    ).toHaveLength(0);

    const first = generateBatchQueue({
      pool,
      settings: settings(),
      lockedPairs: [],
      remaining: remainingAll(pool, 2),
      laneCount: 2,
    });
    const asRows: BatchCountableMatch[] = first.map((plan) => {
      const [a1, a2, b1, b2] = [
        plan.sideA.kind === "players" ? plan.sideA.player1 : null,
        plan.sideA.kind === "players" ? plan.sideA.player2 : null,
        plan.sideB.kind === "players" ? plan.sideB.player1 : null,
        plan.sideB.kind === "players" ? plan.sideB.player2 : null,
      ];
      return { status: "pending", side_a_player1: a1, side_a_player2: a2, side_b_player1: b1, side_b_player2: b2 };
    });
    const existing = countFixedAppearances(asRows);
    const remaining = new Map(
      pool.map((p) => [p.id, Math.max(0, 2 - (existing.get(p.id) ?? 0))]),
    );
    const second = generateBatchQueue({
      pool,
      settings: settings(),
      lockedPairs: [],
      remaining,
      laneCount: 2,
    });
    expect(second).toHaveLength(0);
  });

  it("rest spacing: with a big enough pool, adjacent matches share no players", () => {
    // 12 doubles players = 3× the match size, so the rested tier always has slack
    // and strict rest-spacing holds. (At exactly 2× — 8 players — rest-spacing is
    // deliberately relaxed to break the foursome lock; see the regression below.)
    const pool = ids(12).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: settings(),
      lockedPairs: [],
      remaining: remainingAll(pool, 2),
      laneCount: 1,
    });
    for (let i = 1; i < plans.length; i++) {
      const prev = new Set(fixedIds(plans[i - 1]));
      const cur = fixedIds(plans[i]);
      expect(cur.some((id) => prev.has(id))).toBe(false);
    }
  });

  it("locked pair always lands on the same side", () => {
    const pool = ids(8).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: settings(),
      lockedPairs: [["A", "B"]],
      remaining: remainingAll(pool, 2),
      laneCount: 1,
    });
    for (const plan of plans) {
      for (const side of [plan.sideA, plan.sideB]) {
        if (side.kind !== "players") continue;
        const s = [side.player1, side.player2];
        if (s.includes("A") || s.includes("B")) {
          expect(s.sort()).toEqual(["A", "B"]);
        }
      }
    }
    const counts = appearanceCounts(plans);
    for (const p of pool) expect(counts.get(p.id) ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("locked player with absent partner is never scheduled", () => {
    const pool = ids(5).map((id) => mkPlayer(id)); // partner "Z" not in pool
    const plans = generateBatchQueue({
      pool,
      settings: settings(),
      lockedPairs: [["A", "Z"]],
      remaining: remainingAll(pool, 1),
      laneCount: 1,
    });
    for (const plan of plans) expect(fixedIds(plan)).not.toContain("A");
  });

  it("impossible strict skill gap terminates with no plans", () => {
    const pool = [
      mkPlayer("A", { level: 1 }),
      mkPlayer("B", { level: 1 }),
      mkPlayer("C", { level: 10 }),
      mkPlayer("D", { level: 10 }),
    ];
    const plans = generateBatchQueue({
      pool,
      settings: settings({
        skill_level_enabled: true,
        queue_mode: "level_match",
        max_skill_gap: 1,
        balance_strictness: "strict",
      }),
      lockedPairs: [],
      remaining: remainingAll(pool, 2),
      laneCount: 1,
    });
    expect(plans).toHaveLength(0);
  });

  it("singles (ppt=1) fair mode fills 2-player matches", () => {
    const pool = ids(6).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: settings({ players_per_team: 1 }),
      lockedPairs: [],
      remaining: remainingAll(pool, 2),
      laneCount: 2,
    });
    expect(plans).toHaveLength(6); // 6 players × 2 games / 2 slots per match
    assertNoPartialSides(plans, 1);
    const counts = appearanceCounts(plans);
    for (const p of pool) expect(counts.get(p.id)).toBe(2);
  });
});

describe("generateBatchQueue — lane mode (winner_stays)", () => {
  const laneSettings = settings({ rotation_mode: "winner_stays" });

  it("K=2: openers first, then winnerOf chains linked to the previous match in the SAME lane", () => {
    // 12 players / 2 courts fills the two openers (8) then chains one round of
    // fresh challengers (4) before the safe-exclusion halts — enough to exercise
    // both the opener and the winnerOf-chain branch.
    const pool = ids(12).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: laneSettings,
      lockedPairs: [],
      remaining: remainingAll(pool, 2),
      laneCount: 2,
    });
    expect(plans.length).toBeGreaterThan(2);

    const lastInLane = new Map<number, number>();
    plans.forEach((plan, i) => {
      expect(plan.lane).not.toBeNull();
      const lane = plan.lane as number;
      if (!lastInLane.has(lane)) {
        // opener: both sides fixed
        expect(plan.sideA.kind).toBe("players");
        expect(plan.sideB.kind).toBe("players");
      } else {
        // chain: sideA = winner of the previous match in this lane
        expect(plan.sideA.kind).toBe("winnerOf");
        if (plan.sideA.kind === "winnerOf") {
          expect(plan.sideA.sourceIndex).toBe(lastInLane.get(lane));
        }
        expect(plan.sideB.kind).toBe("players");
      }
      lastInLane.set(lane, i);
    });
  });

  it("challengers never overlap the previous lane match's fixed players", () => {
    const pool = ids(12).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: laneSettings,
      lockedPairs: [],
      remaining: remainingAll(pool, 3),
      laneCount: 2,
    });
    for (const plan of plans) {
      if (plan.sideA.kind !== "winnerOf") continue;
      const source = plans[plan.sideA.sourceIndex];
      const sourceIds = new Set(fixedIds(source));
      for (const id of fixedIds(plan)) expect(sourceIds.has(id)).toBe(false);
    }
  });

  it("winner_stays: each player is a fixed challenger at most once — winnerOf bonus games don't count toward N", () => {
    // 12 players / 2 courts: two openers (8) + one chained round of fresh
    // challengers (4) exactly consumes the pool, so every player is seated once.
    const pool = ids(12).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: laneSettings,
      lockedPairs: [],
      remaining: remainingAll(pool, 2),
      laneCount: 2,
    });
    // winners chain via the (uncounted) winnerOf slot
    expect(plans.some((p) => p.sideA.kind === "winnerOf" || p.sideB.kind === "winnerOf")).toBe(true);
    const counts = appearanceCounts(plans);
    // A static winner_stays plan can never seat a player as a fixed challenger
    // twice: a second fixed seat could face them while they're still the promoted
    // incumbent. So fixed counts cap at 1 regardless of N (=2 here) — the winner's
    // extra games run through the winnerOf slot, which appearanceCounts ignores.
    for (const p of pool) expect(counts.get(p.id) ?? 0).toBe(1);
  });

  it("laneCount is floored at 1 and singles chains work", () => {
    const pool = ids(4).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: settings({ rotation_mode: "winner_stays", players_per_team: 1 }),
      lockedPairs: [],
      remaining: remainingAll(pool, 2),
      laneCount: 0,
    });
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) expect(plan.lane).toBe(0);
    // opener {A} vs {B}, then winnerOf vs a fresh challenger — chain reached
    expect(plans.some((p) => p.sideA.kind === "winnerOf")).toBe(true);
    const counts = appearanceCounts(plans);
    // each player seated once as a fixed player; the winner holds the court via
    // the uncounted winnerOf slot (a second fixed seat could face them incumbent)
    for (const p of pool) expect(counts.get(p.id) ?? 0).toBe(1);
  });

  it("terminates when the pool is too small to chain (exclusion leaves no challengers)", () => {
    const pool = ids(4).map((id) => mkPlayer(id)); // doubles: opener uses all 4
    const plans = generateBatchQueue({
      pool,
      settings: laneSettings,
      lockedPairs: [],
      remaining: remainingAll(pool, 3),
      laneCount: 1,
    });
    // opener consumes everyone; every later challenger side would need players
    // outside the previous match — none exist → generator stops cleanly.
    expect(plans).toHaveLength(1);
  });
});

describe("generateBatchQueue — variety (partner / opponent spread)", () => {
  /** partnership pairKey → times used across the plan (doubles only) */
  function partnershipCounts(plans: BatchMatchPlan[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const plan of plans) {
      for (const side of [plan.sideA, plan.sideB]) {
        if (side.kind === "players" && side.player2) {
          const k = pairKey(side.player1, side.player2);
          m.set(k, (m.get(k) ?? 0) + 1);
        }
      }
    }
    return m;
  }

  /** the side a player sits on in a plan, or null */
  function sideOf(plan: BatchMatchPlan, id: string): "a" | "b" | null {
    const on = (s: BatchMatchPlan["sideA"]) =>
      s.kind === "players" && (s.player1 === id || s.player2 === id);
    if (on(plan.sideA)) return "a";
    if (on(plan.sideB)) return "b";
    return null;
  }

  it("8 players N=3 → no partnership is used twice (12 distinct pairs)", () => {
    const pool = ids(8).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: settings(),
      lockedPairs: [],
      remaining: remainingAll(pool, 3),
      laneCount: 1,
    });
    const counts = partnershipCounts(plans);
    // 6 matches × 2 partnerships each, all distinct.
    expect([...counts.values()].every((v) => v === 1)).toBe(true);
    expect(counts.size).toBe(12);
  });

  it("seeded history steers the split away from an already-partnered pair", () => {
    // A & B have partnered three times already tonight.
    const seed: BatchCountableMatch[] = Array.from({ length: 3 }, () => ({
      status: "completed",
      side_a_player1: "A",
      side_a_player2: "B",
      side_b_player1: "C",
      side_b_player2: "D",
    }));
    const history = buildPairHistory(seed);

    const pool = ids(4).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: settings(),
      lockedPairs: [],
      remaining: remainingAll(pool, 1),
      laneCount: 1,
      history,
    });
    expect(plans).toHaveLength(1);
    // Fresh split must put A and B on OPPOSITE sides (they've teamed up plenty).
    expect(sideOf(plans[0], "A")).not.toBe(sideOf(plans[0], "B"));
  });

  it("variety never overrides a locked pair — they stay teammates despite history", () => {
    // History that would tempt the split to break A|B apart, but they're locked.
    const seed: BatchCountableMatch[] = Array.from({ length: 4 }, () => ({
      status: "completed",
      side_a_player1: "A",
      side_a_player2: "B",
      side_b_player1: "C",
      side_b_player2: "D",
    }));
    const pool = ids(8).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: settings(),
      lockedPairs: [["A", "B"]],
      remaining: remainingAll(pool, 2),
      laneCount: 1,
      history: buildPairHistory(seed),
    });
    for (const plan of plans) {
      const a = sideOf(plan, "A");
      const b = sideOf(plan, "B");
      if (a || b) expect(a).toBe(b); // whenever either plays, they're on the same side
    }
  });

  it("still lands everyone on their target with history seeded (fairness > variety)", () => {
    const pool = ids(8).map((id) => mkPlayer(id));
    const seed: BatchCountableMatch[] = [
      { status: "completed", side_a_player1: "A", side_a_player2: "B", side_b_player1: "C", side_b_player2: "D" },
    ];
    const plans = generateBatchQueue({
      pool,
      settings: settings(),
      lockedPairs: [],
      remaining: remainingAll(pool, 2),
      laneCount: 1,
      history: buildPairHistory(seed),
    });
    const counts = appearanceCounts(plans);
    for (const p of pool) expect(counts.get(p.id) ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("even division + high N does not freeze into fixed foursomes (regression)", () => {
    // Regression for the foursome-lock bug: when the pool divides evenly into
    // rounds (12 players / 4 = 3 matches) and the tier was keyed on the per-match
    // finish stamp, variety could only reshuffle inside a locked group of 4 → the
    // same 3 matchups repeated every round (distinctMatchups=3, every partnership
    // repeated N times). Keying the tier on games-played frees the pool to mix.
    const pool = ids(12).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: settings({ queue_mode: "level_match" }),
      lockedPairs: [],
      remaining: remainingAll(pool, 6),
      laneCount: 1,
    });
    expect(plans).toHaveLength(18); // 12 × 6 / 4
    expect(appearanceCounts(plans).size).toBe(12);

    const counts = partnershipCounts(plans);
    // Pre-fix this collapsed to 6 partnerships each repeated 6×. Post-fix the
    // spread is wide and no pair repeats more than a couple of times.
    expect(counts.size).toBeGreaterThanOrEqual(20);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(4);

    // Rest-spacing invariant still holds on this perfectly even pool.
    for (let i = 1; i < plans.length; i++) {
      const prev = new Set(fixedIds(plans[i - 1]));
      expect(fixedIds(plans[i]).some((id) => prev.has(id))).toBe(false);
    }
  });

  it("even division at pool == 2× match size mixes foursomes instead of locking (regression)", () => {
    // Foursome-lock regression: 8 doubles players on one court split evenly into
    // two foursomes. Under strict rest-spacing the rested tier is always the exact
    // complement, so {A,B,C,D} and {E,F,G,H} alternate forever and never meet
    // (distinctFoursomes=2, crossHalf=0). Relaxing rest-spacing at the 2× boundary
    // lets variety pick cross-half groupings — probe: distinctFoursomes 2→14, all
    // 28 partnerships reached, maxPartnerRepeat=2.
    const pool = ids(8).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: settings({ queue_mode: "level_match" }),
      lockedPairs: [],
      remaining: remainingAll(pool, 8),
      laneCount: 1,
    });
    const firstHalf = new Set(ids(8).slice(0, 4)); // A B C D
    const crossHalf = plans.filter((p) => {
      const four = fixedIds(p);
      return four.some((id) => firstHalf.has(id)) && four.some((id) => !firstHalf.has(id));
    });
    expect(crossHalf.length).toBeGreaterThan(0); // the two halves genuinely meet
    const foursomes = new Set(plans.map((p) => [...fixedIds(p)].sort().join("")));
    expect(foursomes.size).toBeGreaterThan(2); // not frozen into two fixed foursomes
    // fairness is still honoured — everyone reaches N (=8)
    const counts = appearanceCounts(plans);
    for (const p of pool) expect(counts.get(p.id) ?? 0).toBeGreaterThanOrEqual(8);
  });

  it("winner_stays: never double-books a player across lanes when courts > fillable pool (regression)", () => {
    // Regression: with 2 courts but only 6 checked-in doubles players, the second
    // lane's opener used to fall back and re-draft the first lane's players → the
    // same person scheduled on both courts at once. A lane that can't be filled
    // with fresh players must simply not open.
    const pool = ids(6).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: settings({ rotation_mode: "winner_stays", players_per_team: 2 }),
      lockedPairs: [],
      remaining: remainingAll(pool, 3),
      laneCount: 2,
    });
    expect(plans.length).toBeGreaterThan(0);
    assertNoConcurrentDoubleBooking(plans);
  });

  it("winner_stays: no cross-lane double-book across multiple rounds (8 players / 2 courts)", () => {
    // 8 players fill two doubles courts exactly, so both lanes stay active for
    // several rounds — exercises the challenger path (not just the opener), which
    // must also exclude players already placed on a court this round.
    const pool = ids(8).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: settings({ rotation_mode: "winner_stays", players_per_team: 2 }),
      lockedPairs: [],
      remaining: remainingAll(pool, 4),
      laneCount: 2,
    });
    expect(plans.some((p) => p.lane === 1)).toBe(true); // both courts genuinely used
    assertNoConcurrentDoubleBooking(plans);
  });
});

describe("planRerollSwap — cross-match side swap when the roster is fully queued", () => {
  function mkMatch(
    id: string,
    a: [string | null, string | null],
    b: [string | null, string | null],
    opts: { status?: string; winnerNext?: string | null } = {},
  ): RerollSwapMatch {
    return {
      id,
      status: opts.status ?? "pending",
      side_a_player1: a[0],
      side_a_player2: a[1],
      side_b_player1: b[0],
      side_b_player2: b[1],
      winner_next_match_id: opts.winnerNext ?? null,
    };
  }
  const sideIds = (m: RerollSwapMatch, slot: "a" | "b") =>
    (slot === "a"
      ? [m.side_a_player1, m.side_a_player2]
      : [m.side_b_player1, m.side_b_player2]
    ).filter((x): x is string => x != null);

  // Apply the swap the way swap_club_match_sides would, and assert no player ends
  // up twice in the same match.
  function applyAndCheck(
    matches: RerollSwapMatch[],
    swap: NonNullable<ReturnType<typeof planRerollSwap>>,
    targetId: string,
  ) {
    const byId = new Map(matches.map((m) => [m.id, { ...m }]));
    const t = byId.get(targetId)!;
    const d = byId.get(swap.donorId)!;
    const tSide = sideIds(t, swap.targetSlot);
    const dSide = sideIds(d, swap.donorSlot);
    const setSide = (m: RerollSwapMatch, slot: "a" | "b", players: string[]) => {
      if (slot === "a") {
        m.side_a_player1 = players[0] ?? null;
        m.side_a_player2 = players[1] ?? null;
      } else {
        m.side_b_player1 = players[0] ?? null;
        m.side_b_player2 = players[1] ?? null;
      }
    };
    setSide(t, swap.targetSlot, dSide);
    setSide(d, swap.donorSlot, tSide);
    for (const m of [t, d]) {
      const all = [
        m.side_a_player1,
        m.side_a_player2,
        m.side_b_player1,
        m.side_b_player2,
      ].filter((x): x is string => x != null);
      expect(new Set(all).size).toBe(all.length); // no player twice in a match
    }
    return { t, d };
  }

  it("finds a safe swap for the whole-roster winner-stays layout (2 openers + 2 chained)", () => {
    const matches = [
      mkMatch("op1", ["p1", "p2"], ["p3", "p4"], { winnerNext: "ch1" }),
      mkMatch("op2", ["p5", "p6"], ["p7", "p8"], { winnerNext: "ch2" }),
      mkMatch("ch1", [null, null], ["p9", "p10"]),
      mkMatch("ch2", [null, null], ["p11", "p12"]),
    ];
    const swap = planRerollSwap("ch1", matches);
    expect(swap).not.toBeNull();
    const { t } = applyAndCheck(matches, swap!, "ch1");
    expect(sideIds(t, swap!.targetSlot)).not.toEqual(["p9", "p10"]); // genuinely changed
  });

  it("refuses a swap that would drop a match's own feeder players onto it (no self-play)", () => {
    // ch1's placeholder side is fed by op1 {p1..p4}; every other pending match only
    // offers a side made of those same players → no safe swap exists.
    const matches = [
      mkMatch("op1", ["p1", "p2"], ["p3", "p4"], { winnerNext: "ch1" }),
      mkMatch("ch1", [null, null], ["p9", "p10"]),
      mkMatch("bad", ["p1", "p2"], ["p3", "p4"]),
    ];
    expect(planRerollSwap("ch1", matches)).toBeNull();
  });

  it("returns null when there is no other pending match to swap with", () => {
    expect(planRerollSwap("m1", [mkMatch("m1", ["p1", "p2"], ["p3", "p4"])])).toBeNull();
  });

  it("ignores in_progress matches as swap partners", () => {
    const matches = [
      mkMatch("m1", ["p1", "p2"], ["p3", "p4"]),
      mkMatch("m2", ["p5", "p6"], ["p7", "p8"], { status: "in_progress" }),
    ];
    expect(planRerollSwap("m1", matches)).toBeNull();
  });

  it("swaps a whole side between two plain full-fixed pending matches, keeping every player", () => {
    const matches = [
      mkMatch("m1", ["p1", "p2"], ["p3", "p4"]),
      mkMatch("m2", ["p5", "p6"], ["p7", "p8"]),
    ];
    const swap = planRerollSwap("m1", matches);
    expect(swap).not.toBeNull();
    const { t, d } = applyAndCheck(matches, swap!, "m1");
    const allT = [t.side_a_player1, t.side_a_player2, t.side_b_player1, t.side_b_player2].filter(Boolean);
    const allD = [d.side_a_player1, d.side_a_player2, d.side_b_player1, d.side_b_player2].filter(Boolean);
    expect(allT.length).toBe(4);
    expect(allD.length).toBe(4);
    expect(new Set([...allT, ...allD]).size).toBe(8); // all 8 preserved, none duplicated
  });
});
