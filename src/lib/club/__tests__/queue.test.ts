import { describe, it, expect } from "vitest";
import { buildNextMatch, type QueuePlayer, type MatchSide } from "@/lib/club/queue";
import {
  parseQueueSettings,
  DEFAULT_QUEUE_SETTINGS,
  type ClubQueueSettings,
} from "@/lib/club/queue-settings";

function settings(overrides: Partial<ClubQueueSettings> = {}): ClubQueueSettings {
  return { ...DEFAULT_QUEUE_SETTINGS, ...overrides };
}

function player(id: string, o: Partial<QueuePlayer> = {}): QueuePlayer {
  return {
    id,
    position: o.position ?? null,
    joined_at: o.joined_at ?? "2026-06-06T10:00:00.000Z",
    level: o.level ?? null,
    games_played: o.games_played ?? 0,
    last_finished_at: o.last_finished_at ?? null,
  };
}

/** All player ids in a proposed match, sorted (side-agnostic). */
function ids(m: { sideA: MatchSide; sideB: MatchSide }): string[] {
  return [m.sideA.player1, m.sideA.player2, m.sideB.player1, m.sideB.player2]
    .filter((x): x is string => x != null)
    .sort();
}

describe("buildNextMatch — pool size", () => {
  it("doubles needs 4 players, null below that", () => {
    const s = settings({ players_per_team: 2 });
    expect(buildNextMatch([player("a"), player("b"), player("c")], s)).toBeNull();
    expect(buildNextMatch([player("a"), player("b"), player("c"), player("d")], s)).not.toBeNull();
  });

  it("singles needs 2 players", () => {
    const s = settings({ players_per_team: 1 });
    expect(buildNextMatch([player("a")], s)).toBeNull();
    const m = buildNextMatch([player("a"), player("b")], s);
    expect(m).not.toBeNull();
    expect(m!.sideA.player2).toBeNull();
    expect(m!.sideB.player2).toBeNull();
  });
});

describe("buildNextMatch — fifo", () => {
  it("takes lowest position first", () => {
    const s = settings({ players_per_team: 2, queue_mode: "fifo" });
    const pool = [
      player("d", { position: 4 }),
      player("a", { position: 1 }),
      player("c", { position: 3 }),
      player("b", { position: 2 }),
      player("e", { position: 5 }),
    ];
    const m = buildNextMatch(pool, s)!;
    expect(ids(m)).toEqual(["a", "b", "c", "d"]);
    // order split: first half sideA
    expect([m.sideA.player1, m.sideA.player2]).toEqual(["a", "b"]);
    expect([m.sideB.player1, m.sideB.player2]).toEqual(["c", "d"]);
  });

  it("null position sorts after numbered, joined_at breaks ties", () => {
    const s = settings({ players_per_team: 1, queue_mode: "fifo" });
    const pool = [
      player("late", { position: null, joined_at: "2026-06-06T10:05:00.000Z" }),
      player("first", { position: 1 }),
    ];
    const m = buildNextMatch(pool, s)!;
    expect(m.sideA.player1).toBe("first");
    expect(m.sideB.player1).toBe("late");
  });
});

describe("buildNextMatch — rest_longest", () => {
  it("never-played (null) come before those who played", () => {
    const s = settings({ players_per_team: 2, queue_mode: "rest_longest" });
    const pool = [
      player("played1", { last_finished_at: "2026-06-06T10:30:00.000Z" }),
      player("fresh1", { last_finished_at: null }),
      player("played2", { last_finished_at: "2026-06-06T10:40:00.000Z" }),
      player("fresh2", { last_finished_at: null }),
      player("played3", { last_finished_at: "2026-06-06T10:50:00.000Z" }),
    ];
    const m = buildNextMatch(pool, s)!;
    expect(ids(m)).toContain("fresh1");
    expect(ids(m)).toContain("fresh2");
    // earliest finishers (longest rest) fill the remaining slots
    expect(ids(m)).toContain("played1");
    expect(ids(m)).not.toContain("played3");
  });

  it("earlier last_finished_at = longer rest = picked first", () => {
    const s = settings({ players_per_team: 1, queue_mode: "rest_longest" });
    const pool = [
      player("recent", { last_finished_at: "2026-06-06T11:00:00.000Z" }),
      player("old", { last_finished_at: "2026-06-06T10:00:00.000Z" }),
    ];
    const m = buildNextMatch(pool, s)!;
    expect(m.sideA.player1).toBe("old");
  });

  it("games_played breaks ties when last_finished_at equal", () => {
    const s = settings({ players_per_team: 1, queue_mode: "rest_longest" });
    const t = "2026-06-06T10:00:00.000Z";
    const pool = [
      player("more", { last_finished_at: t, games_played: 5 }),
      player("fewer", { last_finished_at: t, games_played: 2 }),
    ];
    const m = buildNextMatch(pool, s)!;
    expect(m.sideA.player1).toBe("fewer");
  });
});

describe("buildNextMatch — level_match", () => {
  it("groups closest levels around the most-rested anchor", () => {
    const s = settings({ players_per_team: 1, queue_mode: "level_match", skill_level_enabled: true });
    const pool = [
      player("anchor", { level: 5, last_finished_at: "2026-06-06T10:00:00.000Z" }),
      player("far", { level: 9, last_finished_at: "2026-06-06T10:10:00.000Z" }),
      player("near", { level: 5.5, last_finished_at: "2026-06-06T10:20:00.000Z" }),
    ];
    const m = buildNextMatch(pool, s)!;
    expect(ids(m)).toEqual(["anchor", "near"]);
  });
});

describe("buildNextMatch — skill-balanced split", () => {
  it("doubles: balances total level across sides", () => {
    const s = settings({ players_per_team: 2, queue_mode: "fifo", skill_level_enabled: true });
    const pool = [
      player("p10", { position: 1, level: 10 }),
      player("p1", { position: 2, level: 1 }),
      player("p8", { position: 3, level: 8 }),
      player("p3", { position: 4, level: 3 }),
    ];
    const m = buildNextMatch(pool, s)!;
    const sum = (side: MatchSide) =>
      (pool.find((p) => p.id === side.player1)!.level ?? 0) +
      (pool.find((p) => p.id === side.player2)!.level ?? 0);
    // greedy balance: 10+1 = 11 vs 8+3 = 11
    expect(sum(m.sideA)).toBe(sum(m.sideB));
  });

  it("without skill flag: split by pick order (no balancing)", () => {
    const s = settings({ players_per_team: 2, queue_mode: "fifo", skill_level_enabled: false });
    const pool = [
      player("p10", { position: 1, level: 10 }),
      player("p1", { position: 2, level: 1 }),
      player("p8", { position: 3, level: 8 }),
      player("p3", { position: 4, level: 3 }),
    ];
    const m = buildNextMatch(pool, s)!;
    expect([m.sideA.player1, m.sideA.player2]).toEqual(["p10", "p1"]);
    expect([m.sideB.player1, m.sideB.player2]).toEqual(["p8", "p3"]);
  });
});

describe("buildNextMatch — winner_stays", () => {
  const staying: MatchSide = { player1: "w1", player2: "w2" };

  it("keeps staying side, draws opponents from pool", () => {
    const s = settings({ players_per_team: 2, rotation_mode: "winner_stays", queue_mode: "rest_longest" });
    const pool = [
      player("x", { last_finished_at: "2026-06-06T10:00:00.000Z" }),
      player("y", { last_finished_at: "2026-06-06T10:10:00.000Z" }),
      player("z", { last_finished_at: "2026-06-06T10:20:00.000Z" }),
    ];
    const m = buildNextMatch(pool, s, staying)!;
    expect(m.sideA).toEqual(staying);
    expect([m.sideB.player1, m.sideB.player2].sort()).toEqual(["x", "y"]);
  });

  it("null when pool too small for opponents", () => {
    const s = settings({ players_per_team: 2, rotation_mode: "winner_stays" });
    expect(buildNextMatch([player("x")], s, staying)).toBeNull();
  });

  it("singles winner_stays draws one opponent", () => {
    const s = settings({ players_per_team: 1, rotation_mode: "winner_stays", queue_mode: "rest_longest" });
    const stay: MatchSide = { player1: "champ", player2: null };
    const pool = [player("a", { last_finished_at: "2026-06-06T10:00:00.000Z" }), player("b", { last_finished_at: "2026-06-06T10:30:00.000Z" })];
    const m = buildNextMatch(pool, s, stay)!;
    expect(m.sideA).toEqual(stay);
    expect(m.sideB.player1).toBe("a");
    expect(m.sideB.player2).toBeNull();
  });

  it("fair_queue ignores stayingSide (both sides from pool)", () => {
    const s = settings({ players_per_team: 1, rotation_mode: "fair_queue", queue_mode: "fifo" });
    const pool = [player("a", { position: 1 }), player("b", { position: 2 })];
    const m = buildNextMatch(pool, s, staying)!;
    expect(ids(m)).toEqual(["a", "b"]);
  });
});

describe("buildNextMatch — locked pairs (doubles)", () => {
  const s = settings({ players_per_team: 2, queue_mode: "fifo" });

  function sideHas(side: MatchSide, x: string, y: string): boolean {
    const ids = [side.player1, side.player2].sort();
    return ids[0] === [x, y].sort()[0] && ids[1] === [x, y].sort()[1];
  }

  it("keeps a locked pair on the same side", () => {
    const pool = [
      player("a", { position: 1 }),
      player("b", { position: 4 }), // far apart in fifo order but locked to a
      player("c", { position: 2 }),
      player("d", { position: 3 }),
    ];
    const m = buildNextMatch(pool, s, undefined, [["a", "b"]])!;
    expect(m).not.toBeNull();
    // a and b must be on the SAME side
    const aSide = m.sideA.player1 === "a" || m.sideA.player2 === "a" ? m.sideA : m.sideB;
    expect([aSide.player1, aSide.player2]).toContain("b");
    // the other side is the two free players c, d
    const other = aSide === m.sideA ? m.sideB : m.sideA;
    expect([other.player1, other.player2].sort()).toEqual(["c", "d"]);
  });

  it("two locked pairs face each other", () => {
    const pool = [
      player("a", { position: 1 }),
      player("c", { position: 2 }),
      player("b", { position: 3 }),
      player("d", { position: 4 }),
    ];
    const m = buildNextMatch(pool, s, undefined, [["a", "b"], ["c", "d"]])!;
    const ab = sideHas(m.sideA, "a", "b") || sideHas(m.sideB, "a", "b");
    const cd = sideHas(m.sideA, "c", "d") || sideHas(m.sideB, "c", "d");
    expect(ab).toBe(true);
    expect(cd).toBe(true);
  });

  it("strict: locked player waits when partner absent", () => {
    // a locked to b, but b not in pool → a must wait. Only c,d,e free → not enough
    // for a full doubles match (need 4) without a.
    const pool = [
      player("a", { position: 1 }), // locked to absent b
      player("c", { position: 2 }),
      player("d", { position: 3 }),
    ];
    expect(buildNextMatch(pool, s, undefined, [["a", "b"]])).toBeNull();
  });

  it("strict: absent-partner lock is skipped, others still play", () => {
    // a(locked→absent b) waits; c,d,e,f free → match from the four frees.
    const pool = [
      player("a", { position: 1 }),
      player("c", { position: 2 }),
      player("d", { position: 3 }),
      player("e", { position: 4 }),
      player("f", { position: 5 }),
    ];
    const m = buildNextMatch(pool, s, undefined, [["a", "b"]])!;
    const ids = [m.sideA.player1, m.sideA.player2, m.sideB.player1, m.sideB.player2];
    expect(ids).not.toContain("a"); // a waited
    expect(ids.filter(Boolean).sort()).toEqual(["c", "d", "e", "f"]);
  });

  it("winner_stays: opponents respect a lock", () => {
    const ws = settings({ players_per_team: 2, rotation_mode: "winner_stays", queue_mode: "fifo" });
    const staying: MatchSide = { player1: "w1", player2: "w2" };
    const pool = [
      player("a", { position: 1 }),
      player("b", { position: 5 }),
      player("z", { position: 2 }),
    ];
    // a-b locked; z is free but alone → opponents must be the locked a-b pair.
    const m = buildNextMatch(pool, ws, staying, [["a", "b"]])!;
    expect(m.sideA).toEqual(staying);
    expect([m.sideB.player1, m.sideB.player2].sort()).toEqual(["a", "b"]);
  });

  it("singles ignores locked pairs", () => {
    const single = settings({ players_per_team: 1, queue_mode: "fifo" });
    const pool = [player("a", { position: 1 }), player("b", { position: 2 })];
    const m = buildNextMatch(pool, single, undefined, [["a", "b"]])!;
    // singles: each side one player; lock has no effect
    expect(m.sideA.player2).toBeNull();
    expect(m.sideB.player2).toBeNull();
    expect([m.sideA.player1, m.sideB.player1].sort()).toEqual(["a", "b"]);
  });
});

describe("parseQueueSettings", () => {
  it("empty -> all defaults", () => {
    expect(parseQueueSettings({})).toEqual(DEFAULT_QUEUE_SETTINGS);
    expect(DEFAULT_QUEUE_SETTINGS.players_per_team).toBe(2);
    expect(DEFAULT_QUEUE_SETTINGS.rotation_mode).toBe("fair_queue");
    expect(DEFAULT_QUEUE_SETTINGS.queue_mode).toBe("rest_longest");
  });

  it("null / non-object -> defaults", () => {
    expect(parseQueueSettings(null)).toEqual(DEFAULT_QUEUE_SETTINGS);
    expect(parseQueueSettings([1, 2])).toEqual(DEFAULT_QUEUE_SETTINGS);
    expect(parseQueueSettings("x")).toEqual(DEFAULT_QUEUE_SETTINGS);
  });

  it("valid partial merges over defaults", () => {
    const r = parseQueueSettings({ court_count: 3, players_per_team: 1, queue_mode: "smart" });
    expect(r.court_count).toBe(3);
    expect(r.players_per_team).toBe(1);
    expect(r.queue_mode).toBe("smart");
    expect(r.rotation_mode).toBe("fair_queue"); // untouched default
  });

  it("per-field fallback: keep valid fields, drop the corrupt one", () => {
    const r = parseQueueSettings({ court_count: 4, players_per_team: 7, queue_mode: "bogus" });
    expect(r.court_count).toBe(4); // valid -> kept
    expect(r.players_per_team).toBe(2); // invalid (not 1|2) -> default
    expect(r.queue_mode).toBe("rest_longest"); // invalid enum -> default
  });

  it("clamps out-of-range via fallback", () => {
    const r = parseQueueSettings({ court_count: 999, game_time_limit_min: -5 });
    expect(r.court_count).toBe(1); // out of range -> default
    expect(r.game_time_limit_min).toBe(0);
  });
});
