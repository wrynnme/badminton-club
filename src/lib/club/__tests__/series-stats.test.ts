import { describe, it, expect } from "vitest";
import { computeSeriesStats, type SeriesStatsMatch, type SeriesStatsPlayer } from "@/lib/club/series-stats";

const session = (id: string, play_date: string) => ({ id, play_date });

const player = (id: string, club_id: string, member_id: string | null): SeriesStatsPlayer => ({
  id,
  club_id,
  member_id,
});

const match = (over: {
  club_id?: string;
  status?: string;
  winner_side?: "a" | "b" | null;
  a1?: string | null;
  a2?: string | null;
  b1?: string | null;
  b2?: string | null;
}): SeriesStatsMatch =>
  ({
    club_id: over.club_id ?? "c1",
    status: over.status ?? "completed",
    // NOTE: `??` treats an explicit `null` the same as `undefined` — since
    // `winner_side: null` is a real test case (no-result completed match), use
    // `in` to distinguish "not provided" (default "a") from "explicitly null".
    winner_side: "winner_side" in over ? (over.winner_side ?? null) : "a",
    side_a_player1: over.a1 ?? "p1",
    side_a_player2: over.a2 ?? null,
    side_b_player1: over.b1 ?? "p2",
    side_b_player2: over.b2 ?? null,
  }) as SeriesStatsMatch;

describe("computeSeriesStats", () => {
  it("empty inputs → empty map, zero totals", () => {
    const s = computeSeriesStats([], [], []);
    expect(s.totalSessions).toBe(0);
    expect(s.totalMatches).toBe(0);
    expect(s.memberStats.size).toBe(0);
  });

  it("member attending but never playing → sessionsAttended>0, matchesPlayed 0", () => {
    const s = computeSeriesStats(
      [session("c1", "2026-07-01")],
      [player("p1", "c1", "m1")],
      [],
    );
    const m1 = s.memberStats.get("m1")!;
    expect(m1.sessionsAttended).toBe(1);
    expect(m1.matchesPlayed).toBe(0);
    expect(m1.wins).toBe(0);
    expect(m1.losses).toBe(0);
    expect(m1.lastPlayDate).toBe("2026-07-01");
  });

  it("walk-in slots (member_id null) are excluded entirely", () => {
    const s = computeSeriesStats(
      [session("c1", "2026-07-01")],
      [player("p1", "c1", "m1"), player("p2", "c1", null)],
      [match({ a1: "p1", b1: "p2", winner_side: "a" })],
    );
    expect(s.memberStats.size).toBe(1);
    const m1 = s.memberStats.get("m1")!;
    expect(m1.matchesPlayed).toBe(1);
    expect(m1.wins).toBe(1);
    expect(m1.losses).toBe(0);
  });

  it("winner_side null on a completed match → played, no win/loss for either side", () => {
    const s = computeSeriesStats(
      [session("c1", "2026-07-01")],
      [player("p1", "c1", "m1"), player("p2", "c1", "m2")],
      [match({ a1: "p1", b1: "p2", winner_side: null })],
    );
    const m1 = s.memberStats.get("m1")!;
    const m2 = s.memberStats.get("m2")!;
    expect(m1.matchesPlayed).toBe(1);
    expect(m1.wins).toBe(0);
    expect(m1.losses).toBe(0);
    expect(m2.matchesPlayed).toBe(1);
    expect(m2.wins).toBe(0);
    expect(m2.losses).toBe(0);
  });

  it("data corruption guard: same member on both sides of one match → played once, no win/loss", () => {
    // Two DIFFERENT club_players rows (p1, p2) both stamped with member_id m1 —
    // p1 seated on side A, p2 seated on side B of the same match.
    const s = computeSeriesStats(
      [session("c1", "2026-07-01")],
      [player("p1", "c1", "m1"), player("p2", "c1", "m1"), player("p3", "c1", "m2")],
      [match({ a1: "p1", b1: "p2", winner_side: "a" })],
    );
    const m1 = s.memberStats.get("m1")!;
    expect(m1.matchesPlayed).toBe(1);
    expect(m1.wins).toBe(0);
    expect(m1.losses).toBe(0);
  });

  it("non-completed matches (pending/in_progress/cancelled) are ignored even if passed in", () => {
    const s = computeSeriesStats(
      [session("c1", "2026-07-01")],
      [player("p1", "c1", "m1"), player("p2", "c1", "m2")],
      [
        match({ status: "pending", a1: "p1", b1: "p2" }),
        match({ status: "in_progress", a1: "p1", b1: "p2" }),
        match({ status: "cancelled", a1: "p1", b1: "p2" }),
      ],
    );
    expect(s.totalMatches).toBe(0);
    expect(s.memberStats.get("m1")?.matchesPlayed ?? 0).toBe(0);
  });

  it("multi-session accumulation: sessionsAttended, matchesPlayed, wins/losses sum across sessions; lastPlayDate is the max", () => {
    const s = computeSeriesStats(
      [session("c1", "2026-06-01"), session("c2", "2026-07-10")],
      [player("p1", "c1", "m1"), player("p2", "c1", "m2"), player("p3", "c2", "m1"), player("p4", "c2", "m2")],
      [
        match({ club_id: "c1", a1: "p1", b1: "p2", winner_side: "a" }), // m1 wins
        match({ club_id: "c2", a1: "p3", b1: "p4", winner_side: "b" }), // m1 loses
      ],
    );
    const m1 = s.memberStats.get("m1")!;
    expect(m1.sessionsAttended).toBe(2);
    expect(m1.matchesPlayed).toBe(2);
    expect(m1.wins).toBe(1);
    expect(m1.losses).toBe(1);
    expect(m1.lastPlayDate).toBe("2026-07-10");
    expect(s.totalSessions).toBe(2);
    expect(s.totalMatches).toBe(2);
  });

  it("doubles match: all four slots resolve to their members and get win/loss correctly", () => {
    const s = computeSeriesStats(
      [session("c1", "2026-07-01")],
      [
        player("p1", "c1", "m1"),
        player("p2", "c1", "m2"),
        player("p3", "c1", "m3"),
        player("p4", "c1", "m4"),
      ],
      [match({ a1: "p1", a2: "p2", b1: "p3", b2: "p4", winner_side: "a" })],
    );
    expect(s.memberStats.get("m1")?.wins).toBe(1);
    expect(s.memberStats.get("m2")?.wins).toBe(1);
    expect(s.memberStats.get("m3")?.losses).toBe(1);
    expect(s.memberStats.get("m4")?.losses).toBe(1);
  });

  it("attending the same session twice (duplicate club_players row) does not double-count sessionsAttended", () => {
    const s = computeSeriesStats(
      [session("c1", "2026-07-01")],
      [player("p1", "c1", "m1"), player("p1dup", "c1", "m1")],
      [],
    );
    expect(s.memberStats.get("m1")?.sessionsAttended).toBe(1);
  });
});
