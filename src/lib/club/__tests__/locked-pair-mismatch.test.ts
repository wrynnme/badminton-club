import { describe, expect, it } from "vitest";
import { playerPresenceMinutes } from "@/lib/club/batch-queue";
import {
  findLockedPairMismatches,
  type LockPlayerTimes,
} from "@/lib/club/queue-preview";

// Session 19:00–21:00 = 120 minutes, mirroring the real club that surfaced this bug.
const CLUB_START = "19:00";
const CLUB_END = "21:00";

function player(
  id: string,
  over: Partial<LockPlayerTimes> = {},
): LockPlayerTimes {
  return {
    id,
    display_name: id,
    start_time: null,
    end_time: null,
    checked_in_at: null,
    ...over,
  };
}

describe("playerPresenceMinutes", () => {
  it("full session when no window is set", () => {
    expect(playerPresenceMinutes(player("A"), CLUB_START, CLUB_END)).toBe(120);
  });

  it("declared end_time shortens the window (leaves early)", () => {
    expect(
      playerPresenceMinutes(player("A", { end_time: "20:00:00" }), CLUB_START, CLUB_END),
    ).toBe(60);
  });

  it("declared start_time shortens the window (arrives late)", () => {
    expect(
      playerPresenceMinutes(player("A", { start_time: "20:30:00" }), CLUB_START, CLUB_END),
    ).toBe(30);
  });

  it("clamps a window that exceeds the session", () => {
    expect(
      playerPresenceMinutes(
        player("A", { start_time: "18:00:00", end_time: "23:00:00" }),
        CLUB_START,
        CLUB_END,
      ),
    ).toBe(120);
  });
});

describe("findLockedPairMismatches", () => {
  it("no mismatch when both players stay the whole session", () => {
    const players = [player("A"), player("B")];
    const locks = [{ player1_id: "A", player2_id: "B" }];
    expect(findLockedPairMismatches(players, locks, CLUB_START, CLUB_END)).toEqual([]);
  });

  it("no mismatch when both leave at the same earlier time", () => {
    const players = [
      player("A", { end_time: "20:00:00" }),
      player("B", { end_time: "20:00:00" }),
    ];
    const locks = [{ player1_id: "A", player2_id: "B" }];
    expect(findLockedPairMismatches(players, locks, CLUB_START, CLUB_END)).toEqual([]);
  });

  it("flags the shorter-staying player regardless of lock column order (BANK+Jxler)", () => {
    // BANK leaves at 20:00 (60 min), Jxler stays full (120 min). BANK is listed as
    // player2 to prove the helper picks the shorter one, not player1.
    const players = [
      player("Jxler"),
      player("BANK", { end_time: "20:00:00" }),
    ];
    const locks = [{ player1_id: "Jxler", player2_id: "BANK" }];
    const out = findLockedPairMismatches(players, locks, CLUB_START, CLUB_END);
    expect(out).toHaveLength(1);
    expect(out[0].shorterName).toBe("BANK");
    expect(out[0].longerName).toBe("Jxler");
    expect(out[0].shorterMinutes).toBe(60);
    expect(out[0].longerMinutes).toBe(120);
  });

  it("detects a late arrival via checked_in_at", () => {
    const players = [
      player("A"),
      player("B", { checked_in_at: "2026-07-14T13:30:00Z" }), // 20:30 Asia/Bangkok
    ];
    const locks = [{ player1_id: "A", player2_id: "B" }];
    const out = findLockedPairMismatches(players, locks, CLUB_START, CLUB_END);
    expect(out).toHaveLength(1);
    expect(out[0].shorterName).toBe("B");
    expect(out[0].shorterMinutes).toBe(30);
  });

  it("skips a lock whose player is missing from the roster", () => {
    const players = [player("A", { end_time: "20:00:00" })];
    const locks = [{ player1_id: "A", player2_id: "GHOST" }];
    expect(findLockedPairMismatches(players, locks, CLUB_START, CLUB_END)).toEqual([]);
  });

  it("returns one entry per mismatched lock across many locks", () => {
    const players = [
      player("A"),
      player("B", { end_time: "20:00:00" }),
      player("C"),
      player("D"),
    ];
    const locks = [
      { player1_id: "A", player2_id: "B" }, // mismatch
      { player1_id: "C", player2_id: "D" }, // equal, skipped
    ];
    const out = findLockedPairMismatches(players, locks, CLUB_START, CLUB_END);
    expect(out).toHaveLength(1);
    expect(out[0].shorterName).toBe("B");
  });
});
