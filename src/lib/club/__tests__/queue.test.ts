import { describe, it, expect } from "vitest";
import {
  buildNextMatch,
  buildPartialMatch,
  deriveWinnerSide,
  isClubMatchFull,
  planWinnerStays,
  resolveCourtStay,
  keepsWinner,
  benchSufficientForFresh,
  allPlayersOf,
  playersInLatestPerCourt,
  type QueuePlayer,
  type MatchSide,
  type CompletedMatchRow,
} from "@/lib/club/queue";
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
    notReady: o.notReady,
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

describe("buildNextMatch — not_ready (requeue: ready-first ordering)", () => {
  it("rest_longest: ready players are picked before a longer-rested not-ready player", () => {
    const s = settings({ players_per_team: 1, queue_mode: "rest_longest" });
    const pool = [
      player("nr", { notReady: true, last_finished_at: null }), // longest rest but NOT ready
      player("r1", { last_finished_at: "2026-06-06T11:00:00.000Z" }),
      player("r2", { last_finished_at: "2026-06-06T11:05:00.000Z" }),
    ];
    const m = buildNextMatch(pool, s)!;
    expect(ids(m)).toEqual(["r1", "r2"]);
    expect(ids(m)).not.toContain("nr");
  });

  it("requeue: a not-ready player fills in only when ready players run short", () => {
    const s = settings({ players_per_team: 1, queue_mode: "rest_longest" });
    const pool = [
      player("r1", { last_finished_at: "2026-06-06T11:00:00.000Z" }), // only one ready
      player("nr1", { notReady: true, last_finished_at: null }), // longest-rested not-ready
      player("nr2", { notReady: true, last_finished_at: "2026-06-06T10:00:00.000Z" }),
    ];
    const m = buildNextMatch(pool, s)!;
    // ready first (r1), then the longest-rested not-ready (nr1); nr2 left behind
    expect(ids(m)).toEqual(["nr1", "r1"]);
  });

  it("fifo: not-ready sorts to the tail regardless of position", () => {
    const s = settings({ players_per_team: 1, queue_mode: "fifo" });
    const pool = [
      player("nr", { notReady: true, position: 1 }), // lowest position but not ready
      player("r", { position: 5 }),
    ];
    const m = buildNextMatch(pool, s)!;
    expect(m.sideA.player1).toBe("r"); // ready first despite higher position
    expect(m.sideB.player1).toBe("nr");
  });

  it("level_match: a ready player beats a closer-level not-ready one", () => {
    const s = settings({
      players_per_team: 1,
      queue_mode: "level_match",
      skill_level_enabled: true,
    });
    const pool = [
      player("anchor", { level: 5, last_finished_at: null }), // ready, longest rest → anchor
      player("nrClose", { level: 5, notReady: true, last_finished_at: null }), // perfect level but not ready
      player("rFar", { level: 1, last_finished_at: "2026-06-06T11:00:00.000Z" }), // ready, far level
    ];
    const m = buildNextMatch(pool, s)!;
    // ready-first beats level proximity → rFar chosen over nrClose
    expect(ids(m)).toEqual(["anchor", "rFar"]);
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

describe("buildNextMatch — pickBalancedMatch (max_skill_gap / balance_strictness)", () => {
  // Anchor = longest-rested (last_finished_at earliest). Others far away in level.
  const anchorTs = "2026-06-06T09:00:00.000Z"; // rested longest
  const otherTs  = "2026-06-06T10:00:00.000Z";

  it("max_skill_gap=0 → same result as pickLevelMatch (backward compat)", () => {
    const s = settings({
      players_per_team: 1,
      queue_mode: "level_match",
      skill_level_enabled: true,
      max_skill_gap: 0,
    });
    const pool = [
      player("anchor", { level: 5, last_finished_at: anchorTs }),
      player("far",    { level: 9, last_finished_at: otherTs }),
      player("near",   { level: 5.5, last_finished_at: otherTs }),
    ];
    const m = buildNextMatch(pool, s)!;
    // Should pick anchor + nearest (near, gap=0.5) — same as pickLevelMatch test above
    expect(ids(m)).toEqual(["anchor", "near"]);
  });

  it("strict: rejects match when all candidates exceed max_skill_gap", () => {
    const s = settings({
      players_per_team: 1,
      queue_mode: "level_match",
      skill_level_enabled: true,
      max_skill_gap: 2,
      balance_strictness: "strict",
    });
    const pool = [
      player("anchor", { level: 5, last_finished_at: anchorTs }),
      player("far1",   { level: 9, last_finished_at: otherTs }),  // gap=4 > 2
      player("far2",   { level: 10, last_finished_at: otherTs }), // gap=5 > 2
    ];
    // No eligible candidate within gap=2 → strict → null
    expect(buildNextMatch(pool, s)).toBeNull();
  });

  it("loose: returns a match even when all candidates exceed max_skill_gap", () => {
    const s = settings({
      players_per_team: 1,
      queue_mode: "level_match",
      skill_level_enabled: true,
      max_skill_gap: 2,
      balance_strictness: "loose",
    });
    const pool = [
      player("anchor", { level: 5, last_finished_at: anchorTs }),
      player("far1",   { level: 9, last_finished_at: otherTs }),
      player("far2",   { level: 10, last_finished_at: otherTs }),
    ];
    // loose → ผ่อนเพดาน → picks nearest available (far1, gap=4)
    const m = buildNextMatch(pool, s)!;
    expect(m).not.toBeNull();
    expect(ids(m)).toContain("anchor");
    expect(ids(m)).toContain("far1"); // nearest of the two far players
  });

  it("strict: picks match when enough candidates are within gap", () => {
    const s = settings({
      players_per_team: 1,
      queue_mode: "level_match",
      skill_level_enabled: true,
      max_skill_gap: 3,
      balance_strictness: "strict",
    });
    const pool = [
      player("anchor", { level: 5, last_finished_at: anchorTs }),
      player("close",  { level: 7, last_finished_at: otherTs }),  // gap=2 ≤ 3
      player("far",    { level: 12, last_finished_at: otherTs }), // gap=7 > 3
    ];
    const m = buildNextMatch(pool, s)!;
    expect(ids(m)).toEqual(["anchor", "close"]);
  });

  it("null-level player is always eligible regardless of max_skill_gap (strict)", () => {
    const s = settings({
      players_per_team: 1,
      queue_mode: "level_match",
      skill_level_enabled: true,
      max_skill_gap: 2,
      balance_strictness: "strict",
    });
    const pool = [
      player("anchor",   { level: 5,    last_finished_at: anchorTs }),
      player("far",      { level: 10,   last_finished_at: otherTs }), // gap=5 > 2
      player("unranked", { level: null, last_finished_at: otherTs }), // null → always eligible
    ];
    // unranked counts as eligible → 1 eligible ≥ need-1(=1) → match formed
    const m = buildNextMatch(pool, s)!;
    expect(m).not.toBeNull();
    expect(ids(m)).toContain("anchor");
    expect(ids(m)).toContain("unranked");
  });

  it("smart mode with skill_level_enabled also routes through pickBalancedMatch", () => {
    const s = settings({
      players_per_team: 1,
      queue_mode: "smart",
      skill_level_enabled: true,
      max_skill_gap: 2,
      balance_strictness: "strict",
    });
    const pool = [
      player("anchor", { level: 5, last_finished_at: anchorTs }),
      player("far1",   { level: 9, last_finished_at: otherTs }),
      player("far2",   { level: 10, last_finished_at: otherTs }),
    ];
    // smart + skill_level_enabled + strict + no eligible → null
    expect(buildNextMatch(pool, s)).toBeNull();
  });
});

describe("buildNextMatch — splitSides intra-side gap tiebreak (ppt=2)", () => {
  it("greedy sum is preserved when it is uniquely optimal (existing test must stay green)", () => {
    // Levels [10,1,8,3]: only one equal-sum partition exists → greedy result kept.
    const s = settings({ players_per_team: 2, queue_mode: "fifo", skill_level_enabled: true });
    const pool = [
      player("p10", { position: 1, level: 10 }),
      player("p1",  { position: 2, level: 1 }),
      player("p8",  { position: 3, level: 8 }),
      player("p3",  { position: 4, level: 3 }),
    ];
    const m = buildNextMatch(pool, s)!;
    const sum = (side: MatchSide) =>
      (pool.find((p) => p.id === side.player1)!.level ?? 0) +
      (pool.find((p) => p.id === side.player2)!.level ?? 0);
    expect(sum(m.sideA)).toBe(sum(m.sideB)); // sums must remain balanced
    expect(sum(m.sideA)).toBe(11);
  });

  it("tiebreak selects partition with lower max intra-side gap when multiple equal-sum exist", () => {
    // Levels [8,8,2,2] sorted desc → 3 partitions:
    //   P1: (8,8)+(2,2)=16+4  — unequal
    //   P2: (8,2)+(8,2)=10+10 — equal, max intra-gap = max(6,6)=6
    //   P3: (8,2)+(8,2)=10+10 — equal, same as P2 (both have gap 6)
    // Greedy: p8a→A(8), p8b→B(8), p2a→A(10), p2b→B(10) → A=[p8a,p2a], B=[p8b,p2b]
    // Both P2/P3 equal-sum and same gap → tiebreak keeps first (stable).
    const s = settings({ players_per_team: 2, queue_mode: "fifo", skill_level_enabled: true });
    const pool = [
      player("p8a", { position: 1, level: 8 }),
      player("p8b", { position: 2, level: 8 }),
      player("p2a", { position: 3, level: 2 }),
      player("p2b", { position: 4, level: 2 }),
    ];
    const m = buildNextMatch(pool, s)!;
    const lvlOf = (id: string | null) => pool.find((p) => p.id === id)?.level ?? 0;
    const sumA = lvlOf(m.sideA.player1) + lvlOf(m.sideA.player2);
    const sumB = lvlOf(m.sideB.player1) + lvlOf(m.sideB.player2);
    expect(sumA).toBe(sumB); // still balanced
    // intra-gap on each side should be ≤ 6 (both sides same level pair)
    expect(Math.abs(lvlOf(m.sideA.player1) - lvlOf(m.sideA.player2))).toBeLessThanOrEqual(6);
    expect(Math.abs(lvlOf(m.sideB.player1) - lvlOf(m.sideB.player2))).toBeLessThanOrEqual(6);
  });
});

describe("buildNextMatch — balance_locked_pairs", () => {
  it("default false: locked-pair match proceeds regardless of level gap", () => {
    const s = settings({
      players_per_team: 2,
      queue_mode: "fifo",
      max_skill_gap: 1,
      balance_strictness: "strict",
      balance_locked_pairs: false, // default — no mean-level check
    });
    const pool = [
      player("a", { position: 1, level: 10 }),
      player("b", { position: 2, level: 10 }),
      player("c", { position: 3, level: 1 }),
      player("d", { position: 4, level: 1 }),
    ];
    // a-b locked (level 10) vs c-d (level 1) — mean gap=9 >> max_skill_gap=1
    // but balance_locked_pairs=false → no check → match proceeds
    const m = buildNextMatch(pool, s, undefined, [["a", "b"]])!;
    expect(m).not.toBeNull();
  });

  it("strict + balance_locked_pairs: rejects when mean gap exceeds max_skill_gap", () => {
    const s = settings({
      players_per_team: 2,
      queue_mode: "fifo",
      max_skill_gap: 1,
      balance_strictness: "strict",
      balance_locked_pairs: true,
    });
    const pool = [
      player("a", { position: 1, level: 10 }),
      player("b", { position: 2, level: 10 }),
      player("c", { position: 3, level: 1 }),
      player("d", { position: 4, level: 1 }),
    ];
    // mean(a,b)=10, mean(c,d)=1, gap=9 > max_skill_gap=1 → null
    expect(buildNextMatch(pool, s, undefined, [["a", "b"]])).toBeNull();
  });

  it("strict + balance_locked_pairs: passes when mean gap is within max_skill_gap", () => {
    const s = settings({
      players_per_team: 2,
      queue_mode: "fifo",
      max_skill_gap: 3,
      balance_strictness: "strict",
      balance_locked_pairs: true,
    });
    const pool = [
      player("a", { position: 1, level: 6 }),
      player("b", { position: 2, level: 5 }),
      player("c", { position: 3, level: 4 }),
      player("d", { position: 4, level: 3 }),
    ];
    // mean(a,b)=5.5, mean(c,d)=3.5, gap=2 ≤ 3 → match proceeds
    const m = buildNextMatch(pool, s, undefined, [["a", "b"]])!;
    expect(m).not.toBeNull();
  });
});

describe("buildNextMatch — null-anchor does not deadlock (FIX 1 P1-A)", () => {
  it("anchor with level=null + strict max_skill_gap still produces a match", () => {
    // anchor is never-played (last_finished_at=null = longest rest, sorts first).
    // All opponents have ranked levels far from 0, which would be gapped-out if
    // anchor.level==null were treated as 0. The fix skips the gap filter entirely
    // when anchor.level is null, so a match must be returned.
    const s = settings({
      players_per_team: 1,
      queue_mode: "level_match",
      skill_level_enabled: true,
      max_skill_gap: 2,
      balance_strictness: "strict",
    });
    const pool = [
      player("anchor",  { level: null, last_finished_at: null }),         // never played → anchor
      player("ranked1", { level: 7, last_finished_at: "2026-06-06T10:00:00.000Z" }),
      player("ranked2", { level: 9, last_finished_at: "2026-06-06T10:10:00.000Z" }),
    ];
    // Without the fix: lvl(anchor)=0, gap to ranked1=7 > 2, gap to ranked2=9 > 2
    // → strict filter removes both candidates → returns null (deadlock).
    // With the fix: anchor.level==null → skip gap filter → nearest picked → match.
    const m = buildNextMatch(pool, s);
    expect(m).not.toBeNull();
    // anchor must be one of the participants
    const matchIds = ids(m!);
    expect(matchIds).toContain("anchor");
  });

  it("doubles: null-anchor + strict gap still forms a 4-player match", () => {
    const s = settings({
      players_per_team: 2,
      queue_mode: "level_match",
      skill_level_enabled: true,
      max_skill_gap: 2,
      balance_strictness: "strict",
    });
    const pool = [
      player("anchor",  { level: null, last_finished_at: null }),
      player("r1", { level: 8, last_finished_at: "2026-06-06T10:00:00.000Z" }),
      player("r2", { level: 9, last_finished_at: "2026-06-06T10:05:00.000Z" }),
      player("r3", { level: 7, last_finished_at: "2026-06-06T10:10:00.000Z" }),
    ];
    const m = buildNextMatch(pool, s);
    expect(m).not.toBeNull();
    expect(ids(m!)).toContain("anchor");
  });
});

describe("deriveWinnerSide", () => {
  it("returns 'a' when side A scores higher", () => {
    expect(deriveWinnerSide(21, 18)).toBe("a");
  });
  it("returns 'b' when side B scores higher", () => {
    expect(deriveWinnerSide(15, 21)).toBe("b");
  });
  it("returns null on a tie", () => {
    expect(deriveWinnerSide(21, 21)).toBeNull();
    expect(deriveWinnerSide(0, 0)).toBeNull();
  });
});

describe("isClubMatchFull", () => {
  const m = (
    a1: string | null,
    a2: string | null,
    b1: string | null,
    b2: string | null,
  ) => ({ side_a_player1: a1, side_a_player2: a2, side_b_player1: b1, side_b_player2: b2 });

  describe("doubles (ppt=2)", () => {
    it("is full only when all four slots are filled", () => {
      expect(isClubMatchFull(m("a", "b", "c", "d"), 2)).toBe(true);
    });
    it("is not full when any slot is empty", () => {
      expect(isClubMatchFull(m("a", "b", "c", null), 2)).toBe(false); // 3 players
      expect(isClubMatchFull(m("a", null, "c", null), 2)).toBe(false); // 2 players (one per side)
      expect(isClubMatchFull(m("a", "b", null, null), 2)).toBe(false); // one side empty
      expect(isClubMatchFull(m("a", null, null, null), 2)).toBe(false); // 1 player
      expect(isClubMatchFull(m(null, null, null, null), 2)).toBe(false); // empty
    });
    it("is not full when a player1 slot is empty even if its player2 is set", () => {
      expect(isClubMatchFull(m(null, "b", "c", "d"), 2)).toBe(false);
    });
  });

  describe("singles (ppt=1)", () => {
    it("is full when both player1 slots are filled (player2 slots ignored)", () => {
      expect(isClubMatchFull(m("a", null, "b", null), 1)).toBe(true);
    });
    it("is not full when a player1 slot is empty", () => {
      expect(isClubMatchFull(m("a", null, null, null), 1)).toBe(false); // 1 player
      expect(isClubMatchFull(m(null, null, "b", null), 1)).toBe(false);
      expect(isClubMatchFull(m(null, null, null, null), 1)).toBe(false); // empty
    });
  });
});

describe("buildPartialMatch", () => {
  const fifo = (o: Partial<ClubQueueSettings> = {}) =>
    settings({ queue_mode: "fifo", players_per_team: 2, ...o });
  const p = (id: string, pos: number) => player(id, { position: pos });

  it("doubles: 3 available → fills a1,a2,b1 in queue order, b2 empty", () => {
    const r = buildPartialMatch([p("c", 3), p("a", 1), p("b", 2)], fifo());
    expect(r).toEqual({ a1: "a", a2: "b", b1: "c", b2: null });
  });
  it("doubles: 2 available → a1,a2 only", () => {
    expect(buildPartialMatch([p("a", 1), p("b", 2)], fifo())).toEqual({
      a1: "a", a2: "b", b1: null, b2: null,
    });
  });
  it("doubles: 1 available → a1 only", () => {
    expect(buildPartialMatch([p("a", 1)], fifo())).toEqual({
      a1: "a", a2: null, b1: null, b2: null,
    });
  });
  it("singles: 1 available → a1 only (b1 empty)", () => {
    expect(buildPartialMatch([p("a", 1)], fifo({ players_per_team: 1 }))).toEqual({
      a1: "a", a2: null, b1: null, b2: null,
    });
  });
  it("empty pool → null", () => {
    expect(buildPartialMatch([], fifo())).toBeNull();
  });
  it("winner_stays: staying side keeps A, opponents fill B (partial)", () => {
    const r = buildPartialMatch(
      [p("x", 1)],
      fifo({ rotation_mode: "winner_stays" }),
      { player1: "w1", player2: "w2" },
    );
    expect(r).toEqual({ a1: "w1", a2: "w2", b1: "x", b2: null });
  });
});

// Helper: a completed match row (DB-shaped) for the winner_stays planners.
function done(
  court: string,
  winner: "a" | "b",
  a: [string, string | null],
  b: [string, string | null],
): CompletedMatchRow {
  return {
    court,
    side_a_player1: a[0],
    side_a_player2: a[1],
    side_b_player1: b[0],
    side_b_player2: b[1],
    winner_side: winner,
  };
}
const elig = (...ids: string[]) => new Set(ids);

describe("resolveCourtStay", () => {
  it("latest winners stay when eligible and cap unlimited (0)", () => {
    const r = resolveCourtStay([done("1", "a", ["w1", "w2"], ["l1", "l2"])], 0, elig("w1", "w2", "l1", "l2"));
    expect(r).not.toBeNull();
    expect(r!.stayingSide).toEqual({ player1: "w1", player2: "w2" });
    expect([...r!.winnerIds].sort()).toEqual(["w1", "w2"]);
  });

  it("null when a winner is no longer eligible", () => {
    expect(resolveCourtStay([done("1", "a", ["w1", "w2"], ["l1", "l2"])], 0, elig("w1", "l1", "l2"))).toBeNull();
  });

  it("respects winner_stays_max cap (streak === max → null)", () => {
    const rows = [
      done("1", "a", ["w1", "w2"], ["x1", "x2"]),
      done("1", "a", ["w1", "w2"], ["y1", "y2"]),
    ];
    expect(resolveCourtStay(rows, 2, elig("w1", "w2"))).toBeNull();
  });

  it("stays while streak below cap", () => {
    expect(resolveCourtStay([done("1", "a", ["w1", "w2"], ["x1", "x2"])], 2, elig("w1", "w2"))).not.toBeNull();
  });

  it("singles staying side has null player2", () => {
    const r = resolveCourtStay([done("1", "b", ["la", null], ["champ", null])], 0, elig("champ", "la"));
    expect(r!.stayingSide).toEqual({ player1: "champ", player2: null });
  });

  it("empty history → null", () => {
    expect(resolveCourtStay([], 0, elig())).toBeNull();
  });
});

describe("planWinnerStays — multi-court winner_stays", () => {
  // The core regression: building court 1 must reserve court 2's just-finished winners
  // so it can't draw them as opponents — otherwise court 2 loses its winner_stays.
  it("reserves other free courts' winners; current court returns stayingSide", () => {
    const rows = [
      done("2", "a", ["p5", "p6"], ["p7", "p8"]),
      done("1", "a", ["p1", "p2"], ["p3", "p4"]),
    ];
    const plan = planWinnerStays(rows, {
      currentCourt: "1",
      courtsWithActiveMatch: new Set(),
      winnerStaysMax: 0,
      eligibleIds: elig("p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"),
    });
    expect(plan.stayingSide).toEqual({ player1: "p1", player2: "p2" });
    expect([...plan.reservedIds].sort()).toEqual(["p5", "p6"]);
  });

  it("does NOT reserve winners of a court that already has an active match", () => {
    const rows = [
      done("2", "a", ["p5", "p6"], ["p7", "p8"]),
      done("1", "a", ["p1", "p2"], ["p3", "p4"]),
    ];
    const plan = planWinnerStays(rows, {
      currentCourt: "1",
      courtsWithActiveMatch: new Set(["2"]),
      winnerStaysMax: 0,
      eligibleIds: elig("p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"),
    });
    expect(plan.reservedIds.size).toBe(0);
  });

  it("single court → nothing reserved", () => {
    const plan = planWinnerStays([done("1", "a", ["p1", "p2"], ["p3", "p4"])], {
      currentCourt: "1",
      courtsWithActiveMatch: new Set(),
      winnerStaysMax: 0,
      eligibleIds: elig("p1", "p2", "p3", "p4"),
    });
    expect(plan.stayingSide).toEqual({ player1: "p1", player2: "p2" });
    expect(plan.reservedIds.size).toBe(0);
  });

  it("a capped-out other court is not reserved", () => {
    const rows = [
      done("2", "a", ["p5", "p6"], ["x1", "x2"]),
      done("2", "a", ["p5", "p6"], ["y1", "y2"]),
      done("1", "a", ["p1", "p2"], ["p3", "p4"]),
    ];
    const plan = planWinnerStays(rows, {
      currentCourt: "1",
      courtsWithActiveMatch: new Set(),
      winnerStaysMax: 2,
      eligibleIds: elig("p1", "p2", "p3", "p4", "p5", "p6"),
    });
    expect(plan.reservedIds.size).toBe(0);
    expect(plan.stayingSide).toEqual({ player1: "p1", player2: "p2" });
  });

  it("ineligible other-court winners are not reserved", () => {
    const rows = [
      done("2", "a", ["p5", "p6"], ["p7", "p8"]),
      done("1", "a", ["p1", "p2"], ["p3", "p4"]),
    ];
    const plan = planWinnerStays(rows, {
      currentCourt: "1",
      courtsWithActiveMatch: new Set(),
      winnerStaysMax: 0,
      eligibleIds: elig("p1", "p2", "p3", "p4"),
    });
    expect(plan.reservedIds.size).toBe(0);
  });

  it("does NOT reserve a court missing from reservableCourts (removed/phantom court)", () => {
    const rows = [
      done("2", "a", ["p5", "p6"], ["p7", "p8"]),
      done("1", "a", ["p1", "p2"], ["p3", "p4"]),
    ];
    const plan = planWinnerStays(rows, {
      currentCourt: "1",
      courtsWithActiveMatch: new Set(),
      winnerStaysMax: 0,
      eligibleIds: elig("p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"),
      reservableCourts: new Set(["1"]), // court "2" no longer in club config
    });
    expect(plan.stayingSide).toEqual({ player1: "p1", player2: "p2" });
    expect(plan.reservedIds.size).toBe(0);
  });

  it("reserves an other court that IS still in reservableCourts", () => {
    const rows = [
      done("2", "a", ["p5", "p6"], ["p7", "p8"]),
      done("1", "a", ["p1", "p2"], ["p3", "p4"]),
    ];
    const plan = planWinnerStays(rows, {
      currentCourt: "1",
      courtsWithActiveMatch: new Set(),
      winnerStaysMax: 0,
      eligibleIds: elig("p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"),
      reservableCourts: new Set(["1", "2"]),
    });
    expect([...plan.reservedIds].sort()).toEqual(["p5", "p6"]);
  });
});

describe("keepsWinner", () => {
  it("true for winner_stays + fair_winner_fallback, false for fair_queue", () => {
    expect(keepsWinner("winner_stays")).toBe(true);
    expect(keepsWinner("fair_winner_fallback")).toBe(true);
    expect(keepsWinner("fair_queue")).toBe(false);
  });
});

describe("allPlayersOf", () => {
  it("returns all 4 players of a doubles match (both sides)", () => {
    expect(allPlayersOf(done("1", "a", ["a", "b"], ["c", "d"])).sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("drops nulls (singles / partial slots)", () => {
    expect(allPlayersOf(done("1", "a", ["a", null], ["b", null])).sort()).toEqual(["a", "b"]);
  });
});

describe("benchSufficientForFresh", () => {
  const mk = (xs: string[]) => xs.map((id) => player(id));
  it("true when bench >= 2*ppt (doubles: 4 fresh)", () => {
    expect(benchSufficientForFresh(mk(["i", "j", "k", "l"]), new Set(), 2)).toBe(true);
  });
  it("true at exactly the 2*ppt boundary", () => {
    const pool = mk(["a", "b", "c", "d", "i", "j", "k", "l"]);
    expect(benchSufficientForFresh(pool, new Set(["a", "b", "c", "d"]), 2)).toBe(true); // bench = 4
  });
  it("false at 2*ppt - 1 (bench = 3)", () => {
    const pool = mk(["a", "b", "c", "d", "i", "j", "k"]);
    expect(benchSufficientForFresh(pool, new Set(["a", "b", "c", "d"]), 2)).toBe(false);
  });
  it("excludes just-played from the bench count", () => {
    const pool = mk(["a", "b", "i", "j", "k", "l"]); // 2 just-played, 4 bench
    expect(benchSufficientForFresh(pool, new Set(["a", "b"]), 2)).toBe(true);
  });
  it("empty justPlayed → whole pool is bench", () => {
    expect(benchSufficientForFresh(mk(["a", "b", "c", "d"]), new Set(), 2)).toBe(true);
    expect(benchSufficientForFresh(mk(["a", "b", "c"]), new Set(), 2)).toBe(false);
  });
  it("singles: bench >= 2 true, bench = 1 false", () => {
    expect(benchSufficientForFresh(mk(["a", "b"]), new Set(), 1)).toBe(true);
    expect(benchSufficientForFresh(mk(["a"]), new Set(), 1)).toBe(false);
  });
});

describe("buildNextMatch — fair_winner_fallback", () => {
  const fwf = (o: Partial<ClubQueueSettings> = {}) =>
    settings({ rotation_mode: "fair_winner_fallback", queue_mode: "rest_longest", ...o });

  it("FAIR (no stayingSide): draws longest-rested, just-played sink to the back", () => {
    const just = "2026-06-06T10:30:00.000Z";
    const pool = [
      player("a", { last_finished_at: just }),
      player("b", { last_finished_at: just }),
      player("c", { last_finished_at: just }),
      player("d", { last_finished_at: just }),
      player("i"),
      player("j"),
      player("k"),
      player("l"),
    ];
    const m = buildNextMatch(pool, fwf())!;
    expect(ids(m)).toEqual(["i", "j", "k", "l"]); // the four fresh players, not the just-played
  });

  it("FALLBACK (stayingSide passed): keeps the winner on side A", () => {
    const staying: MatchSide = { player1: "w1", player2: "w2" };
    const pool = [
      player("x", { last_finished_at: "2026-06-06T10:00:00.000Z" }),
      player("y", { last_finished_at: "2026-06-06T10:10:00.000Z" }),
    ];
    const m = buildNextMatch(pool, fwf(), staying)!;
    expect(m.sideA).toEqual(staying);
    expect([m.sideB.player1, m.sideB.player2].sort()).toEqual(["x", "y"]);
  });

  it("FALLBACK singles: champion stays vs one opponent", () => {
    const stay: MatchSide = { player1: "champ", player2: null };
    const m = buildNextMatch([player("a")], fwf({ players_per_team: 1 }), stay)!;
    expect(m.sideA).toEqual(stay);
    expect(m.sideB.player1).toBe("a");
    expect(m.sideB.player2).toBeNull();
  });

  it("FALLBACK + locked pair: staying side kept, opponents respect the lock", () => {
    const staying: MatchSide = { player1: "w1", player2: "w2" };
    const pool = [player("a"), player("b"), player("c"), player("d")];
    const m = buildNextMatch(pool, fwf({ queue_mode: "fifo" }), staying, [["a", "b"]])!;
    expect(m.sideA).toEqual(staying);
    expect([m.sideB.player1, m.sideB.player2].sort()).toEqual(["a", "b"]);
  });
});

describe("buildPartialMatch — fair_winner_fallback", () => {
  it("keeps staying side on A, fills B partially", () => {
    const s = settings({ rotation_mode: "fair_winner_fallback", queue_mode: "fifo" });
    const r = buildPartialMatch([player("x", { position: 1 })], s, { player1: "w1", player2: "w2" });
    expect(r).toEqual({ a1: "w1", a2: "w2", b1: "x", b2: null });
  });
});

describe("parseQueueSettings — fair_winner_fallback", () => {
  it("round-trips the new rotation_mode", () => {
    expect(parseQueueSettings({ rotation_mode: "fair_winner_fallback" }).rotation_mode).toBe(
      "fair_winner_fallback",
    );
  });
});

describe("playersInLatestPerCourt", () => {
  it("unions the LATEST match per court (newest-first), ignoring older rows on the same court", () => {
    const rows = [
      done("1", "a", ["a", "b"], ["c", "d"]), // court 1 latest
      done("2", "a", ["e", "f"], ["g", "h"]), // court 2 latest
      done("1", "a", ["x", "y"], ["z", "w"]), // court 1 OLDER — must be ignored
    ];
    expect([...playersInLatestPerCourt(rows)].sort()).toEqual([
      "a", "b", "c", "d", "e", "f", "g", "h",
    ]);
  });

  it("empty rows → empty set", () => {
    expect(playersInLatestPerCourt([]).size).toBe(0);
  });
});
