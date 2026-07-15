import { describe, it, expect } from "vitest";
import {
  buildLockedPairRows,
  buildRosterSeedRows,
  buildSessionInsert,
  type SeriesMemberForSeed,
} from "@/lib/club/open-session";
import { DEFAULT_SESSION_DEFAULTS, SESSION_FALLBACKS } from "@/lib/club/session-defaults";

describe("buildSessionInsert", () => {
  it("falls back to SESSION_FALLBACKS / schema-empty values when defaults are all null", () => {
    const insert = buildSessionInsert({
      series: { id: "s1", name: "MUGGLE", owner_id: "owner-1" },
      defaults: DEFAULT_SESSION_DEFAULTS,
      playDate: "2026-07-20",
    });

    expect(insert).toEqual({
      name: "MUGGLE",
      owner_id: "owner-1",
      series_id: "s1",
      play_date: "2026-07-20",
      venue: SESSION_FALLBACKS.venue,
      start_time: SESSION_FALLBACKS.start_time,
      end_time: SESSION_FALLBACKS.end_time,
      max_players: SESSION_FALLBACKS.max_players,
      court_fee: 0,
      shuttle_price: 0,
      court_split: "even",
      shuttle_split: "even",
      courts: [],
      queue_settings: DEFAULT_SESSION_DEFAULTS.queue_settings,
    });
  });

  it("uses explicit series defaults verbatim when set (including a real 0 fee)", () => {
    const insert = buildSessionInsert({
      series: { id: "s1", name: "MUGGLE", owner_id: "owner-1" },
      defaults: {
        ...DEFAULT_SESSION_DEFAULTS,
        venue: "โรงยิม",
        start_time: "17:00",
        end_time: "20:00",
        max_players: 20,
        court_fee: 0, // explicit free court — must not be confused with "unset"
        shuttle_price: 25,
        court_split: "by_time",
        shuttle_split: "per_player",
        courts: ["A", "B"],
      },
      playDate: "2026-07-20",
    });

    expect(insert.venue).toBe("โรงยิม");
    expect(insert.start_time).toBe("17:00");
    expect(insert.max_players).toBe(20);
    expect(insert.court_fee).toBe(0);
    expect(insert.shuttle_price).toBe(25);
    expect(insert.court_split).toBe("by_time");
    expect(insert.shuttle_split).toBe("per_player");
    expect(insert.courts).toEqual(["A", "B"]);
  });
});

function member(over: Partial<SeriesMemberForSeed> & { id: string }): SeriesMemberForSeed {
  return {
    profile_id: null,
    canonical_name: "Player",
    default_level_id: null,
    is_regular: true,
    first_linked_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("buildRosterSeedRows", () => {
  it("seeds only is_regular members, ordered by first_linked_at then canonical_name", () => {
    const members = [
      member({ id: "m3", canonical_name: "Zed", first_linked_at: "2026-01-03T00:00:00Z" }),
      member({ id: "m1", canonical_name: "Anna", first_linked_at: "2026-01-01T00:00:00Z" }),
      member({ id: "m2", canonical_name: "Bee", is_regular: false, first_linked_at: "2026-01-02T00:00:00Z" }),
    ];
    const rows = buildRosterSeedRows({ members, maxPlayers: 12 });
    expect(rows.map((r) => r.member_id)).toEqual(["m1", "m3"]);
    expect(rows.every((r) => r.status === "active")).toBe(true);
    expect(rows.map((r) => r.position)).toEqual([1, 2]);
  });

  it("breaks a first_linked_at tie by canonical_name", () => {
    const tie = "2026-01-01T00:00:00Z";
    const members = [
      member({ id: "mZ", canonical_name: "Zed", first_linked_at: tie }),
      member({ id: "mA", canonical_name: "Anna", first_linked_at: tie }),
    ];
    const rows = buildRosterSeedRows({ members, maxPlayers: 12 });
    expect(rows.map((r) => r.member_id)).toEqual(["mA", "mZ"]);
  });

  it("puts regulars beyond maxPlayers into reserve (overflow), preserving order", () => {
    const members = Array.from({ length: 5 }, (_, i) =>
      member({ id: `m${i}`, canonical_name: `P${i}`, first_linked_at: `2026-01-0${i + 1}T00:00:00Z` }),
    );
    const rows = buildRosterSeedRows({ members, maxPlayers: 3 });
    expect(rows.filter((r) => r.status === "active")).toHaveLength(3);
    expect(rows.filter((r) => r.status === "reserve")).toHaveLength(2);
    expect(rows.slice(0, 3).every((r) => r.status === "active")).toBe(true);
    expect(rows.slice(3).every((r) => r.status === "reserve")).toBe(true);
  });

  it("carries a null default_level_id through untouched", () => {
    const rows = buildRosterSeedRows({ members: [member({ id: "m1", default_level_id: null })], maxPlayers: 12 });
    expect(rows[0].level_id).toBeNull();
  });

  it("carries a set default_level_id through", () => {
    const rows = buildRosterSeedRows({
      members: [member({ id: "m1", default_level_id: "lvl-1" })],
      maxPlayers: 12,
    });
    expect(rows[0].level_id).toBe("lvl-1");
  });

  it("returns [] when there are no is_regular members", () => {
    const rows = buildRosterSeedRows({
      members: [member({ id: "m1", is_regular: false })],
      maxPlayers: 12,
    });
    expect(rows).toEqual([]);
  });
});

describe("buildLockedPairRows", () => {
  it("skips a pair when one member was not seeded this session", () => {
    const rows = buildLockedPairRows({
      pairs: [{ id: "p1", member1_id: "m1", member2_id: "m2" }],
      playerIdByMemberId: new Map([["m1", "pl1"]]), // m2 missing — not seeded (e.g. not is_regular)
    });
    expect(rows).toEqual([]);
  });

  it("skips a pair when neither member was seeded", () => {
    const rows = buildLockedPairRows({
      pairs: [{ id: "p1", member1_id: "m1", member2_id: "m2" }],
      playerIdByMemberId: new Map(),
    });
    expect(rows).toEqual([]);
  });

  it("seeds a pair when both members were seeded", () => {
    const rows = buildLockedPairRows({
      pairs: [{ id: "p1", member1_id: "m1", member2_id: "m2" }],
      playerIdByMemberId: new Map([
        ["m1", "pl1"],
        ["m2", "pl2"],
      ]),
    });
    expect(rows).toEqual([{ player1_id: "pl1", player2_id: "pl2", games_remaining: null }]);
  });

  it("drops a later pair that reuses an already-claimed member (first wins)", () => {
    const rows = buildLockedPairRows({
      pairs: [
        { id: "p1", member1_id: "m1", member2_id: "m2" },
        { id: "p2", member1_id: "m2", member2_id: "m3" }, // m2 already claimed by p1
      ],
      playerIdByMemberId: new Map([
        ["m1", "pl1"],
        ["m2", "pl2"],
        ["m3", "pl3"],
      ]),
    });
    expect(rows).toEqual([{ player1_id: "pl1", player2_id: "pl2", games_remaining: null }]);
  });

  it("returns [] for no pairs", () => {
    expect(buildLockedPairRows({ pairs: [], playerIdByMemberId: new Map() })).toEqual([]);
  });
});
