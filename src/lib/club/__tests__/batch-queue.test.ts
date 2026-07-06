import { describe, it, expect } from "vitest";
import {
  resolvePlayerWindow,
  computePlayerTarget,
  proRatedTarget,
  countFixedAppearances,
  generateBatchQueue,
  type BatchMatchPlan,
  type BatchCountableMatch,
} from "../batch-queue";
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
    const pool = ids(8).map((id) => mkPlayer(id));
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
    const pool = ids(8).map((id) => mkPlayer(id));
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
    const pool = ids(8).map((id) => mkPlayer(id));
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

  it("winnerOf slots don't count toward N — fixed appearances reach the target", () => {
    const pool = ids(8).map((id) => mkPlayer(id));
    const plans = generateBatchQueue({
      pool,
      settings: laneSettings,
      lockedPairs: [],
      remaining: remainingAll(pool, 2),
      laneCount: 2,
    });
    const counts = appearanceCounts(plans);
    for (const p of pool) expect(counts.get(p.id) ?? 0).toBeGreaterThanOrEqual(2);
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
    const counts = appearanceCounts(plans);
    for (const p of pool) expect(counts.get(p.id) ?? 0).toBeGreaterThanOrEqual(2);
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
