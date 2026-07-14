import { describe, it, expect } from "vitest";
import {
  countLockedTeammateMatches,
  deriveLockBudgets,
  generateBatchQueue,
  type BatchCountableMatch,
  type BatchMatchPlan,
  type LockRow,
} from "../batch-queue";
import { pairKey } from "../pair-history";
import { DEFAULT_QUEUE_SETTINGS, type ClubQueueSettings } from "../queue-settings";
import type { QueuePlayer } from "../queue";

function mkPlayer(id: string): QueuePlayer {
  return {
    id,
    position: null,
    joined_at: "2026-07-14T10:00:00.000Z",
    level: null,
    games_played: 0,
    last_finished_at: null,
  };
}

function settings(overrides: Partial<ClubQueueSettings> = {}): ClubQueueSettings {
  return { ...DEFAULT_QUEUE_SETTINGS, players_per_team: 2, ...overrides };
}

function mkMatch(
  status: string,
  a1: string | null,
  a2: string | null,
  b1: string | null,
  b2: string | null,
): BatchCountableMatch {
  return {
    status,
    side_a_player1: a1,
    side_a_player2: a2,
    side_b_player1: b1,
    side_b_player2: b2,
  };
}

/** matches in a generated plan where a & b sit on the same side (teammates) */
function sameSideCount(plans: BatchMatchPlan[], a: string, b: string): number {
  let n = 0;
  for (const plan of plans) {
    for (const side of [plan.sideA, plan.sideB]) {
      if (side.kind !== "players") continue;
      const ids = [side.player1, side.player2];
      if (ids.includes(a) && ids.includes(b)) n++;
    }
  }
  return n;
}

describe("countLockedTeammateMatches", () => {
  it("counts pending + in_progress + completed same-side, skips cancelled", () => {
    const matches = [
      mkMatch("pending", "A", "B", "C", "D"), // teammates ✓
      mkMatch("completed", "C", "A", "B", "D"), // A vs B — opponents ✗
      mkMatch("in_progress", "B", "A", "E", "F"), // teammates ✓
      mkMatch("cancelled", "A", "B", "C", "D"), // cancelled ✗
    ];
    expect(countLockedTeammateMatches(matches, "A", "B")).toBe(2);
  });
});

describe("deriveLockBudgets", () => {
  const key = pairKey("A", "B");

  it("forever (NULL quota) → active with Infinity budget", () => {
    const rows: LockRow[] = [{ player1_id: "A", player2_id: "B", games_remaining: null }];
    const { active, budget } = deriveLockBudgets(rows, []);
    expect(active).toHaveLength(1);
    expect(budget.get(key)).toBe(Infinity);
  });

  it("N-game quota minus existing teammate matches (refund is automatic)", () => {
    const rows: LockRow[] = [{ player1_id: "A", player2_id: "B", games_remaining: 3 }];
    // 2 pending teammate matches already on the board → remaining 1.
    const matches = [
      mkMatch("pending", "A", "B", "C", "D"),
      mkMatch("completed", "A", "B", "E", "F"),
    ];
    const { active, budget } = deriveLockBudgets(rows, matches);
    expect(active).toHaveLength(1);
    expect(budget.get(key)).toBe(1);
  });

  it("quota fully consumed → dropped (not active)", () => {
    const rows: LockRow[] = [{ player1_id: "A", player2_id: "B", games_remaining: 3 }];
    const matches = [
      mkMatch("pending", "A", "B", "C", "D"),
      mkMatch("pending", "A", "B", "E", "F"),
      mkMatch("completed", "A", "B", "C", "D"),
    ];
    const { active, budget } = deriveLockBudgets(rows, matches);
    expect(active).toHaveLength(0);
    expect(budget.has(key)).toBe(false);
  });

  it("over quota clamps to 0 (still dropped, never negative)", () => {
    const rows: LockRow[] = [{ player1_id: "A", player2_id: "B", games_remaining: 2 }];
    const matches = [
      mkMatch("pending", "A", "B", "C", "D"),
      mkMatch("pending", "A", "B", "E", "F"),
      mkMatch("pending", "A", "B", "C", "E"),
    ];
    const { active } = deriveLockBudgets(rows, matches);
    expect(active).toHaveLength(0);
  });
});

describe("generateBatchQueue — locked-pair budget cap", () => {
  const pool = ["A", "B", "C", "D", "E", "F"].map(mkPlayer);
  const remaining = new Map(pool.map((p) => [p.id, 5])); // high target: many games each
  const key = pairKey("A", "B");

  it("caps a lock at its budget, then pairs the pair freely", () => {
    const plans = generateBatchQueue({
      pool,
      settings: settings(),
      lockedPairs: [["A", "B"]],
      lockBudget: new Map([[key, 2]]),
      remaining: new Map(remaining),
      laneCount: 1,
    });
    expect(sameSideCount(plans, "A", "B")).toBeLessThanOrEqual(2);
    // A and B still reach their targets — the budget doesn't strand them.
    const appear = (id: string) =>
      plans.filter((p) =>
        [p.sideA, p.sideB].some(
          (s) => s.kind === "players" && (s.player1 === id || s.player2 === id),
        ),
      ).length;
    expect(appear("A")).toBeGreaterThanOrEqual(4);
    expect(appear("B")).toBeGreaterThanOrEqual(4);
  });

  it("without a budget the lock forces them together far more (proves the cap bites)", () => {
    const plans = generateBatchQueue({
      pool,
      settings: settings(),
      lockedPairs: [["A", "B"]],
      // no lockBudget → forever behaviour
      remaining: new Map(remaining),
      laneCount: 1,
    });
    expect(sameSideCount(plans, "A", "B")).toBeGreaterThan(2);
  });
});
