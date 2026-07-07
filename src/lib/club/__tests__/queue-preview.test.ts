import { describe, it, expect } from "vitest";
import { buildPreviewRows, type PreviewRow } from "../queue-preview";
import type { ClubMatch } from "@/lib/types";

// buildPreviewRows backs GenerateQueueDialog's ("สุ่มคิว") preview table. It lives in
// this framework-free lib module (not the "use client" dialog file) specifically so it
// can be unit tested here — the repo has no jsdom/@testing-library/react setup
// (vitest.config.ts uses environment: "node" and only includes *.test.ts), and
// importing the dialog directly would also drag in `@/lib/actions/club-matches`
// ("use server", pulls in `server-only`) which throws at import time under plain node.

type PreviewPlayer = {
  id: string;
  display_name: string;
  status: string;
  checked_in_at: string | null;
  start_time: string | null;
  end_time: string | null;
};

function mkPlayer(id: string, overrides: Partial<PreviewPlayer> = {}): PreviewPlayer {
  return {
    id,
    display_name: id,
    status: "active",
    checked_in_at: null,
    start_time: null,
    end_time: null,
    ...overrides,
  };
}

// Only status/side_*_player* are read (via countFixedAppearances) — other ClubMatch
// fields are irrelevant to buildPreviewRows, so a minimal cast keeps fixtures short.
function mkMatch(overrides: Partial<ClubMatch> & { status: ClubMatch["status"] }): ClubMatch {
  return {
    id: "m1",
    club_id: "c1",
    court: null,
    side_a_player1: null,
    side_a_player2: null,
    side_b_player1: null,
    side_b_player2: null,
    winner_next_match_id: null,
    winner_next_match_slot: null,
    shuttles_used: 0,
    queue_position: null,
    winner_side: null,
    score_a: null,
    score_b: null,
    games: [],
    started_at: null,
    ended_at: null,
    created_at: "2026-07-07T10:00:00.000Z",
    ...overrides,
  };
}

function rowById(rows: PreviewRow[], id: string): PreviewRow | undefined {
  return rows.find((r) => r.id === id);
}

describe("buildPreviewRows", () => {
  const CLUB_START = "18:00";
  const CLUB_END = "22:00"; // 240-minute session

  it("includes every active player when nobody is checked in", () => {
    const players = [mkPlayer("p1"), mkPlayer("p2")];
    const rows = buildPreviewRows(players, [], 3, CLUB_START, CLUB_END);
    expect(rows.map((r) => r.id).sort()).toEqual(["p1", "p2"]);
  });

  it("restricts to checked-in players once any player is checked in", () => {
    const players = [
      mkPlayer("p1", { checked_in_at: "2026-07-07T11:00:00.000Z" }),
      mkPlayer("p2"), // not checked in — excluded
    ];
    const rows = buildPreviewRows(players, [], 3, CLUB_START, CLUB_END);
    expect(rows.map((r) => r.id)).toEqual(["p1"]);
  });

  it("gives a fully-present player the full N as target", () => {
    const players = [mkPlayer("p1")];
    const rows = buildPreviewRows(players, [], 4, CLUB_START, CLUB_END);
    expect(rowById(rows, "p1")?.target).toBe(4);
  });

  it("pro-rates the target from a declared start/end window", () => {
    // 19:00-21:00 = 120 of 240 session minutes = 0.5 fraction
    const players = [mkPlayer("p1", { start_time: "19:00:00", end_time: "21:00:00" })];
    const rows = buildPreviewRows(players, [], 4, CLUB_START, CLUB_END);
    expect(rowById(rows, "p1")?.target).toBe(2);
  });

  it("pro-rates the target from checked_in_at (Bangkok wall-clock) when no declared window", () => {
    // 11:00 UTC = 18:00 Asia/Bangkok = the full club window (no shortening)
    const full = buildPreviewRows(
      [mkPlayer("p1", { checked_in_at: "2026-07-07T11:00:00.000Z" })],
      [],
      4,
      CLUB_START,
      CLUB_END,
    );
    expect(rowById(full, "p1")?.target).toBe(4);

    // 13:00 UTC = 20:00 Asia/Bangkok -> 120 of 240 minutes remain = 0.5 fraction
    const half = buildPreviewRows(
      [mkPlayer("p1", { checked_in_at: "2026-07-07T13:00:00.000Z" })],
      [],
      4,
      CLUB_START,
      CLUB_END,
    );
    expect(rowById(half, "p1")?.target).toBe(2);
  });

  it("subtracts existing fixed appearances (top-up semantics) into 'have' and 'shortfall'", () => {
    const players = [mkPlayer("p1"), mkPlayer("p2")];
    const matches = [
      mkMatch({ status: "completed", side_a_player1: "p1", side_b_player1: "p2" }),
      mkMatch({ status: "pending", side_a_player1: "p1", side_b_player1: "p2" }),
    ];
    const rows = buildPreviewRows(players, matches, 3, CLUB_START, CLUB_END);
    expect(rowById(rows, "p1")).toMatchObject({ target: 3, have: 2, shortfall: 1 });
    expect(rowById(rows, "p2")).toMatchObject({ target: 3, have: 2, shortfall: 1 });
  });

  it("never returns a negative shortfall when a player already has more than their target", () => {
    const players = [mkPlayer("p1")];
    const matches = [
      mkMatch({ status: "completed", side_a_player1: "p1", side_b_player1: "x" }),
      mkMatch({ status: "completed", side_a_player1: "p1", side_b_player1: "x" }),
      mkMatch({ status: "completed", side_a_player1: "p1", side_b_player1: "x" }),
    ];
    const rows = buildPreviewRows(players, matches, 1, CLUB_START, CLUB_END);
    expect(rowById(rows, "p1")).toMatchObject({ target: 1, have: 3, shortfall: 0 });
  });

  it("ignores cancelled matches when counting existing appearances", () => {
    const players = [mkPlayer("p1")];
    const matches = [mkMatch({ status: "cancelled", side_a_player1: "p1", side_b_player1: "x" })];
    const rows = buildPreviewRows(players, matches, 2, CLUB_START, CLUB_END);
    expect(rowById(rows, "p1")).toMatchObject({ have: 0, shortfall: 2 });
  });
});
