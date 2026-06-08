import { describe, it, expect } from "vitest";
import {
  teamToCompetitor,
  pairToCompetitor,
  buildCompetitorMap,
} from "../competitor";
import type { Team, PairWithPlayers, TeamPlayer } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: "team-1",
    tournament_id: "t1",
    name: "Red Team",
    color: "#ff0000",
    seed: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makePlayer(overrides: Partial<TeamPlayer> = {}): TeamPlayer {
  return {
    id: "player-1",
    team_id: "team-1",
    profile_id: null,
    display_name: "Alice",
    role: "member",
    level: "3",
    level_id: null,
    csv_id: null,
    checked_in_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makePair(overrides: Partial<PairWithPlayers> = {}): PairWithPlayers {
  return {
    id: "pair-1",
    team_id: "team-1",
    class_id: null,
    player_id_1: "player-1",
    player_id_2: "player-2",
    display_pair_name: null,
    pair_level: "6",
    created_at: "2026-01-01T00:00:00Z",
    player1: makePlayer({ id: "player-1", display_name: "Alice" }),
    player2: makePlayer({ id: "player-2", display_name: "Bob" }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// teamToCompetitor
// ---------------------------------------------------------------------------
describe("teamToCompetitor", () => {
  it("sets id from team.id", () => {
    const c = teamToCompetitor(makeTeam({ id: "abc" }));
    expect(c.id).toBe("abc");
  });

  it("sets name from team.name", () => {
    const c = teamToCompetitor(makeTeam({ name: "Blue Dragons" }));
    expect(c.name).toBe("Blue Dragons");
  });

  it("sets color from team.color", () => {
    const c = teamToCompetitor(makeTeam({ color: "#0000ff" }));
    expect(c.color).toBe("#0000ff");
  });

  it("null color propagates", () => {
    const c = teamToCompetitor(makeTeam({ color: null }));
    expect(c.color).toBeNull();
  });

  it("teamId equals team.id", () => {
    const c = teamToCompetitor(makeTeam({ id: "xyz" }));
    expect(c.teamId).toBe("xyz");
  });

  it("subtitle is undefined (teams have no subtitle)", () => {
    const c = teamToCompetitor(makeTeam());
    expect(c.subtitle).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// pairToCompetitor — name formation
// ---------------------------------------------------------------------------
describe("pairToCompetitor name formation", () => {
  it("uses player1/player2 display_names when no display_pair_name", () => {
    const c = pairToCompetitor(makePair());
    expect(c.name).toBe("Alice / Bob");
  });

  it("uses display_pair_name when set (non-empty)", () => {
    const c = pairToCompetitor(makePair({ display_pair_name: "Ace Pair" }));
    expect(c.name).toBe("Ace Pair");
  });

  it("subtitle is player names when display_pair_name is set", () => {
    const c = pairToCompetitor(makePair({ display_pair_name: "Ace Pair" }));
    expect(c.subtitle).toBe("Alice / Bob");
  });

  it("subtitle is undefined when display_pair_name is null", () => {
    const c = pairToCompetitor(makePair({ display_pair_name: null }));
    expect(c.subtitle).toBeUndefined();
  });

  it("falls back to 'คู่ไม่มีชื่อ' when both players have empty names and no display_pair_name", () => {
    const p = makePair({
      display_pair_name: null,
      player1: makePlayer({ display_name: "" }),
      player2: makePlayer({ display_name: "" }),
    });
    const c = pairToCompetitor(p);
    expect(c.name).toBe("คู่ไม่มีชื่อ");
  });

  it("falls back to 'คู่ไม่มีชื่อ' when both players are null", () => {
    const p = makePair({ player1: null, player2: null, display_pair_name: null });
    const c = pairToCompetitor(p);
    expect(c.name).toBe("คู่ไม่มีชื่อ");
  });

  it("single player name used when one player is null", () => {
    const p = makePair({ player2: null, display_pair_name: null });
    const c = pairToCompetitor(p);
    expect(c.name).toBe("Alice");
  });

  it("sets id from pair.id", () => {
    const c = pairToCompetitor(makePair({ id: "pair-99" }));
    expect(c.id).toBe("pair-99");
  });

  it("sets teamId from pair.team_id", () => {
    const c = pairToCompetitor(makePair({ team_id: "team-42" }));
    expect(c.teamId).toBe("team-42");
  });

  it("uses team color when team is provided", () => {
    const team = makeTeam({ color: "#abcdef" });
    const c = pairToCompetitor(makePair(), team);
    expect(c.color).toBe("#abcdef");
  });

  it("color is undefined when no team provided", () => {
    const c = pairToCompetitor(makePair());
    expect(c.color).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildCompetitorMap — team unit
// ---------------------------------------------------------------------------
describe("buildCompetitorMap team unit", () => {
  const teams = [
    makeTeam({ id: "t1", name: "Red" }),
    makeTeam({ id: "t2", name: "Blue" }),
  ];

  it("builds a map keyed by team.id", () => {
    const map = buildCompetitorMap("team", teams, []);
    expect(map.size).toBe(2);
    expect(map.has("t1")).toBe(true);
    expect(map.has("t2")).toBe(true);
  });

  it("values are Competitor objects with correct names", () => {
    const map = buildCompetitorMap("team", teams, []);
    expect(map.get("t1")?.name).toBe("Red");
    expect(map.get("t2")?.name).toBe("Blue");
  });

  it("empty teams → empty map", () => {
    const map = buildCompetitorMap("team", [], []);
    expect(map.size).toBe(0);
  });

  it("ignores pairs when unit=team", () => {
    const pairs = [makePair({ id: "p1", team_id: "t1" })];
    const map = buildCompetitorMap("team", teams, pairs);
    expect(map.has("p1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildCompetitorMap — pair unit
// ---------------------------------------------------------------------------
describe("buildCompetitorMap pair unit", () => {
  const teams = [makeTeam({ id: "team-1", color: "#red" })];
  const pairs = [
    makePair({ id: "p1", team_id: "team-1" }),
    makePair({ id: "p2", team_id: "team-1", player1: makePlayer({ display_name: "Charlie" }), player2: makePlayer({ display_name: "Dave" }) }),
  ];

  it("builds a map keyed by pair.id", () => {
    const map = buildCompetitorMap("pair", teams, pairs);
    expect(map.size).toBe(2);
    expect(map.has("p1")).toBe(true);
    expect(map.has("p2")).toBe(true);
  });

  it("pair competitor name uses player names", () => {
    const map = buildCompetitorMap("pair", teams, pairs);
    expect(map.get("p1")?.name).toBe("Alice / Bob");
    expect(map.get("p2")?.name).toBe("Charlie / Dave");
  });

  it("does not include team IDs as keys", () => {
    const map = buildCompetitorMap("pair", teams, pairs);
    expect(map.has("team-1")).toBe(false);
  });

  it("empty pairs → empty map", () => {
    const map = buildCompetitorMap("pair", teams, []);
    expect(map.size).toBe(0);
  });

  it("pair's team color is applied via team lookup", () => {
    const map = buildCompetitorMap("pair", teams, pairs);
    // teams[0] has color "#red", pairs both belong to "team-1"
    expect(map.get("p1")?.color).toBe("#red");
  });

  it("pair with no matching team gets undefined color", () => {
    const orphanPair = makePair({ id: "p-orphan", team_id: "nonexistent" });
    const map = buildCompetitorMap("pair", teams, [orphanPair]);
    expect(map.get("p-orphan")?.color).toBeUndefined();
  });
});
