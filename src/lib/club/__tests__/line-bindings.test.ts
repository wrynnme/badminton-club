import { describe, it, expect } from "vitest";
import { buildLineBindingInventory } from "@/lib/club/line-bindings.server";

describe("buildLineBindingInventory", () => {
  it("returns a series row picking the latest session by play_date, then created_at", () => {
    const boundSeries = [{ id: "s1", owner_id: "o1", name: "MUGGLE" }];
    const sessions = [
      { id: "c1", series_id: "s1", play_date: "2026-06-01", created_at: "2026-06-01T00:00:00Z" },
      { id: "c2", series_id: "s1", play_date: "2026-07-01", created_at: "2026-07-01T00:00:00Z" },
      // Same play_date as c2, earlier created_at — c2 should still win the tie-break.
      { id: "c3", series_id: "s1", play_date: "2026-07-01", created_at: "2026-06-30T00:00:00Z" },
    ];
    const ownerNameById = new Map([["o1", "Owner One"]]);

    const rows = buildLineBindingInventory(boundSeries, sessions, [], ownerNameById);

    expect(rows).toEqual([
      {
        target: { kind: "series", seriesId: "s1" },
        level: "series",
        clubName: "MUGGLE",
        ownerName: "Owner One",
        latestPlayDate: "2026-07-01",
      },
    ]);
  });

  it("returns latestPlayDate null for a bound series with zero sessions", () => {
    const boundSeries = [{ id: "s1", owner_id: "o1", name: "MUGGLE" }];
    const rows = buildLineBindingInventory(boundSeries, [], [], new Map());
    expect(rows[0].latestPlayDate).toBeNull();
  });

  it("dedupes a legacy club row already covered by its own bound series", () => {
    const boundSeries = [{ id: "s1", owner_id: "o1", name: "MUGGLE" }];
    const sessions = [
      { id: "c1", series_id: "s1", play_date: "2026-07-01", created_at: "2026-07-01T00:00:00Z" },
    ];
    const legacyBoundClubs = [
      {
        id: "c1",
        owner_id: "o1",
        name: "MUGGLE",
        series_id: "s1", // covered by boundSeries above — must NOT produce a second row
        play_date: "2026-07-01",
        created_at: "2026-07-01T00:00:00Z",
      },
    ];

    const rows = buildLineBindingInventory(boundSeries, sessions, legacyBoundClubs, new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toEqual({ kind: "series", seriesId: "s1" });
  });

  it("includes an orphan legacy club with series_id null as its own legacy row", () => {
    const legacyBoundClubs = [
      {
        id: "c9",
        owner_id: "o9",
        name: "เฉพาะกิจเก่า",
        series_id: null,
        play_date: "2026-05-01",
        created_at: "2026-05-01T00:00:00Z",
      },
    ];
    const ownerNameById = new Map([["o9", "Owner Nine"]]);

    const rows = buildLineBindingInventory([], [], legacyBoundClubs, ownerNameById);

    expect(rows).toEqual([
      {
        target: { kind: "legacy", clubId: "c9" },
        level: "legacy",
        clubName: "เฉพาะกิจเก่า",
        ownerName: "Owner Nine",
        latestPlayDate: "2026-05-01",
      },
    ]);
  });

  it("includes an orphan legacy club whose series exists but is NOT itself bound", () => {
    // series "s2" has no line_group_id (not in boundSeries) — the stale legacy
    // clubs.line_group_id on one of its sessions is a real orphan binding.
    const legacyBoundClubs = [
      {
        id: "c5",
        owner_id: "o5",
        name: "ก๊วนวันพุธ",
        series_id: "s2",
        play_date: "2026-04-10",
        created_at: "2026-04-10T00:00:00Z",
      },
    ];

    const rows = buildLineBindingInventory([], [], legacyBoundClubs, new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toEqual({ kind: "legacy", clubId: "c5" });
  });

  it("falls back to an empty owner name when the owner id is missing from the map", () => {
    const boundSeries = [{ id: "s1", owner_id: "unknown-owner", name: "MUGGLE" }];
    const rows = buildLineBindingInventory(boundSeries, [], [], new Map());
    expect(rows[0].ownerName).toBe("");
  });

  it("sorts most-recently-played first, with zero-session series (null) last", () => {
    const boundSeries = [
      { id: "s-old", owner_id: "o1", name: "Old" },
      { id: "s-new", owner_id: "o1", name: "New" },
      { id: "s-empty", owner_id: "o1", name: "Empty" },
    ];
    const sessions = [
      { id: "c-old", series_id: "s-old", play_date: "2026-01-01", created_at: "2026-01-01T00:00:00Z" },
      { id: "c-new", series_id: "s-new", play_date: "2026-07-01", created_at: "2026-07-01T00:00:00Z" },
    ];

    const rows = buildLineBindingInventory(boundSeries, sessions, [], new Map());
    expect(rows.map((r) => r.clubName)).toEqual(["New", "Old", "Empty"]);
  });
});
