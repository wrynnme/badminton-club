import { describe, it, expect } from "vitest";
import {
  planBulkStartCourts,
  type BulkStartCandidate,
} from "@/lib/club/bulk-start";

/** Minimal full-roster doubles candidate; override per test. */
function candidate(over: Partial<BulkStartCandidate> & { id: string }): BulkStartCandidate {
  return {
    court: null,
    playerIds: [],
    isFull: true,
    hasLivePlaceholder: false,
    ...over,
  };
}

describe("planBulkStartCourts", () => {
  it("assigns free courts in queue order to full courtless matches", () => {
    const plan = planBulkStartCourts(
      [
        candidate({ id: "m1", playerIds: ["a", "b", "c", "d"] }),
        candidate({ id: "m2", playerIds: ["e", "f", "g", "h"] }),
      ],
      ["1", "2", "3"],
      [],
    );
    expect(plan.toStart).toEqual([
      { id: "m1", court: "1" },
      { id: "m2", court: "2" },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("keeps a match's own court when it is free", () => {
    const plan = planBulkStartCourts(
      [
        candidate({ id: "m1", court: "3", playerIds: ["a", "b", "c", "d"] }),
        candidate({ id: "m2", playerIds: ["e", "f", "g", "h"] }),
      ],
      ["1", "2", "3"],
      [],
    );
    // m1 keeps court 3; m2 takes the first free court (1), not 3.
    expect(plan.toStart).toEqual([
      { id: "m1", court: "3" },
      { id: "m2", court: "1" },
    ]);
  });

  it("reassigns a match off a court already held by an in_progress match", () => {
    const plan = planBulkStartCourts(
      [candidate({ id: "m1", court: "1", playerIds: ["a", "b", "c", "d"] })],
      ["1", "2"],
      ["1"], // court 1 is occupied by a live match
    );
    expect(plan.toStart).toEqual([{ id: "m1", court: "2" }]);
  });

  it("skips a match when no court is free (more selected than courts)", () => {
    const plan = planBulkStartCourts(
      [
        candidate({ id: "m1", playerIds: ["a", "b", "c", "d"] }),
        candidate({ id: "m2", playerIds: ["e", "f", "g", "h"] }),
        candidate({ id: "m3", playerIds: ["i", "j", "k", "l"] }),
      ],
      ["1", "2"],
      [],
    );
    expect(plan.toStart).toEqual([
      { id: "m1", court: "1" },
      { id: "m2", court: "2" },
    ]);
    expect(plan.skipped).toEqual([{ id: "m3", reason: "no_court" }]);
  });

  it("starts only one when all matches pre-assign to the same court", () => {
    const plan = planBulkStartCourts(
      [
        candidate({ id: "m1", court: "1", playerIds: ["a", "b", "c", "d"] }),
        candidate({ id: "m2", court: "1", playerIds: ["e", "f", "g", "h"] }),
      ],
      ["1"], // only one court exists
      [],
    );
    expect(plan.toStart).toEqual([{ id: "m1", court: "1" }]);
    expect(plan.skipped).toEqual([{ id: "m2", reason: "no_court" }]);
  });

  it("skips a not-full match", () => {
    const plan = planBulkStartCourts(
      [candidate({ id: "m1", isFull: false, playerIds: ["a"] })],
      ["1"],
      [],
    );
    expect(plan.toStart).toEqual([]);
    expect(plan.skipped).toEqual([{ id: "m1", reason: "not_full" }]);
  });

  it("skips a match still waiting on a winner (live placeholder) before the not-full check", () => {
    const plan = planBulkStartCourts(
      [candidate({ id: "m1", isFull: false, hasLivePlaceholder: true, playerIds: ["a", "b"] })],
      ["1"],
      [],
    );
    expect(plan.skipped).toEqual([{ id: "m1", reason: "waiting_winner" }]);
  });

  it("skips a match sharing a player with one already started earlier in the batch", () => {
    const plan = planBulkStartCourts(
      [
        candidate({ id: "m1", playerIds: ["a", "b", "c", "d"] }),
        candidate({ id: "m2", playerIds: ["a", "e", "f", "g"] }), // shares "a"
      ],
      ["1", "2"],
      [],
    );
    expect(plan.toStart).toEqual([{ id: "m1", court: "1" }]);
    expect(plan.skipped).toEqual([{ id: "m2", reason: "player_busy" }]);
  });

  it("skips a match sharing a player with a currently-live in_progress match", () => {
    const plan = planBulkStartCourts(
      [candidate({ id: "m1", playerIds: ["x", "b", "c", "d"] })],
      ["1", "2"],
      ["2"], // court 2 occupied
      ["x"], // player x already busy in a live match
    );
    expect(plan.toStart).toEqual([]);
    expect(plan.skipped).toEqual([{ id: "m1", reason: "player_busy" }]);
  });

  it("frees a court for a later match once earlier skips leave one open", () => {
    // m1 keeps its own court 2; m2 (courtless) takes court 1; m3 shares a player
    // with m1 → skipped, so its would-be court stays unclaimed.
    const plan = planBulkStartCourts(
      [
        candidate({ id: "m1", court: "2", playerIds: ["a", "b", "c", "d"] }),
        candidate({ id: "m2", playerIds: ["e", "f", "g", "h"] }),
        candidate({ id: "m3", playerIds: ["a", "i", "j", "k"] }),
      ],
      ["1", "2"],
      [],
    );
    expect(plan.toStart).toEqual([
      { id: "m1", court: "2" },
      { id: "m2", court: "1" },
    ]);
    expect(plan.skipped).toEqual([{ id: "m3", reason: "player_busy" }]);
  });
});
