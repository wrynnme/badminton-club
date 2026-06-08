import { describe, it, expect } from "vitest";
import { computeClubDashboard } from "@/lib/club/dashboard";

// Minimal row factories — fns take Pick<> subsets, so partials suffice.
const player = (id: string, status: "active" | "reserve" = "active") => ({ id, status });
const match = (over: {
  status?: string;
  court?: string | null;
  shuttles_used?: number;
  a1?: string | null;
  a2?: string | null;
  b1?: string | null;
  b2?: string | null;
}) => ({
  status: over.status ?? "completed",
  court: over.court ?? "1",
  shuttles_used: over.shuttles_used ?? 1,
  side_a_player1: over.a1 ?? "p1",
  side_a_player2: over.a2 ?? null,
  side_b_player1: over.b1 ?? "p2",
  side_b_player2: over.b2 ?? null,
}) as Parameters<typeof computeClubDashboard>[1][number];

describe("computeClubDashboard", () => {
  it("empty club → all zeros, empty maps/arrays", () => {
    const d = computeClubDashboard([], []);
    expect(d.activePlayers).toBe(0);
    expect(d.totalPlayers).toBe(0);
    expect(d.completedMatches).toBe(0);
    expect(d.totalShuttles).toBe(0);
    expect(d.gamesByPlayer.size).toBe(0);
    expect(d.courtUsage).toEqual([]);
  });

  it("counts active vs reserve players", () => {
    const d = computeClubDashboard(
      [player("p1"), player("p2"), player("p3", "reserve")],
      [],
    );
    expect(d.activePlayers).toBe(2);
    expect(d.reservePlayers).toBe(1);
    expect(d.totalPlayers).toBe(3);
  });

  it("counts only completed matches for games/court/shuttles", () => {
    const d = computeClubDashboard(
      [player("p1"), player("p2"), player("p3"), player("p4")],
      [
        match({ court: "1", shuttles_used: 2, a1: "p1", a2: "p2", b1: "p3", b2: "p4" }), // completed doubles
        match({ status: "in_progress", court: "2", shuttles_used: 5, a1: "p1", b1: "p2" }),
        match({ status: "pending", court: "1", a1: "p3", b1: "p4" }),
        match({ status: "cancelled", court: "1", a1: "p1", b1: "p2" }),
      ],
    );
    expect(d.completedMatches).toBe(1);
    expect(d.inProgressMatches).toBe(1);
    expect(d.pendingMatches).toBe(1);
    expect(d.totalGames).toBe(1);
    expect(d.totalShuttles).toBe(2); // only the completed match's shuttles
    // each of the 4 players appeared in the one completed match
    expect(d.gamesByPlayer.get("p1")).toBe(1);
    expect(d.gamesByPlayer.get("p4")).toBe(1);
    expect(d.gamesByPlayer.size).toBe(4);
    expect(d.courtUsage).toEqual([{ court: "1", matches: 1 }]);
  });

  it("singles match (null player2) does not count null as a participant", () => {
    const d = computeClubDashboard(
      [player("p1"), player("p2")],
      [match({ a1: "p1", a2: null, b1: "p2", b2: null })],
    );
    expect(d.gamesByPlayer.size).toBe(2);
    expect(d.gamesByPlayer.has("")).toBe(false);
  });

  it("court usage sorted by count desc then court name asc", () => {
    const d = computeClubDashboard(
      [player("p1"), player("p2")],
      [
        match({ court: "2", a1: "p1", b1: "p2" }),
        match({ court: "2", a1: "p1", b1: "p2" }),
        match({ court: "1", a1: "p1", b1: "p2" }),
        match({ court: "3", a1: "p1", b1: "p2" }),
      ],
    );
    expect(d.courtUsage).toEqual([
      { court: "2", matches: 2 },
      { court: "1", matches: 1 },
      { court: "3", matches: 1 },
    ]);
  });

  it("blank court name is skipped in court usage", () => {
    const d = computeClubDashboard(
      [player("p1"), player("p2")],
      [match({ court: "", a1: "p1", b1: "p2" })],
    );
    expect(d.courtUsage).toEqual([]);
    expect(d.completedMatches).toBe(1); // still counts as a game
  });
});
