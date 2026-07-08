import { describe, it, expect } from "vitest";
import { clampedSessionMinutes } from "@/lib/club/cost-split";
import { computePlayerUsage, formatHours, computeClubCostRows } from "@/lib/club/cost-summary";
import type { Club, ClubPlayer, ClubMatch } from "@/lib/types";

describe("clampedSessionMinutes", () => {
  it("full window = whole session", () => {
    expect(clampedSessionMinutes("18:00", "21:00", "18:00", "21:00")).toBe(180);
  });
  it("partial window inside the session", () => {
    expect(clampedSessionMinutes("19:00", "20:00", "18:00", "21:00")).toBe(60);
  });
  it("clamps a window that overstays the session", () => {
    expect(clampedSessionMinutes("17:00", "22:00", "18:00", "21:00")).toBe(180);
  });
  it("cross-midnight session", () => {
    // 21:00 → 01:00 = 240 min; player present the whole time.
    expect(clampedSessionMinutes("21:00", "01:00", "21:00", "01:00")).toBe(240);
    // player only the second half (23:00 → 01:00) = 120.
    expect(clampedSessionMinutes("23:00", "01:00", "21:00", "01:00")).toBe(120);
  });
  it("zero-length / inverted window → 0", () => {
    expect(clampedSessionMinutes("18:00", "18:00", "18:00", "18:00")).toBe(0);
  });
});

describe("formatHours", () => {
  it("drops trailing .0 and rounds to one decimal", () => {
    expect(formatHours(3)).toBe("3");
    expect(formatHours(2.5)).toBe("2.5");
    expect(formatHours(80 / 60)).toBe("1.3"); // 1.333…
    expect(formatHours(0)).toBe("0");
  });
});

describe("computePlayerUsage", () => {
  const club = { start_time: "18:00", end_time: "21:00" } as Club;
  const players = [
    { id: "A", start_time: null, end_time: null }, // full 3h
    { id: "B", start_time: "19:00", end_time: "21:00" }, // 2h
  ] as ClubPlayer[];

  function m(
    status: ClubMatch["status"],
    ids: (string | null)[],
    shuttles: number,
  ): ClubMatch {
    return {
      status,
      side_a_player1: ids[0] ?? null,
      side_a_player2: ids[1] ?? null,
      side_b_player1: ids[2] ?? null,
      side_b_player2: ids[3] ?? null,
      shuttles_used: shuttles,
    } as ClubMatch;
  }

  it("hours from clamped window; shuttles summed over joined in_progress+completed matches", () => {
    const usage = computePlayerUsage({
      club,
      players,
      matches: [
        m("completed", ["A", "B", null, null], 3), // A,B +3
        m("in_progress", ["A", null, null, null], 2), // A +2 (singles)
        m("pending", ["A", "B", null, null], 9), // ignored (pending)
      ],
    });
    expect(usage.get("A")).toEqual({ hours: 3, shuttles: 5 }); // 3+2
    expect(usage.get("B")).toEqual({ hours: 2, shuttles: 3 });
  });

  it("credits the FULL match shuttle count to every participant (usage, not a share)", () => {
    const usage = computePlayerUsage({
      club,
      players,
      matches: [m("completed", ["A", "B", null, null], 4)],
    });
    expect(usage.get("A")?.shuttles).toBe(4);
    expect(usage.get("B")?.shuttles).toBe(4);
  });
});

describe("computeClubCostRows", () => {
  const club = {
    owner_id: "owner",
    court_fee: 100,
    court_split: "even",
    shuttle_split: "even",
    shuttle_price: 0,
    start_time: "18:00",
    end_time: "21:00",
    court_gap_policy: "spread",
  } as Club;
  const players = [
    { id: "A", profile_id: null, start_time: null, end_time: null, games_played: 0, discount: 5 },
    { id: "B", profile_id: null, start_time: null, end_time: null, games_played: 0, discount: 0 },
  ] as ClubPlayer[];

  it("folds court + expense − discount + usage + games into one row each; totals reconcile", () => {
    const withGames = players.map((p, i) => ({ ...p, games_played: i === 0 ? 7 : 4 }));
    const { rows, totalCourt, totalExp, totalDiscount, grandTotal, totalShuttlesUsed } =
      computeClubCostRows({
        club,
        players: withGames,
        matches: [],
        expenses: [{ amount: 20, payer_player_ids: [] }], // split all → ceil(10) each
      });
    const byId = Object.fromEntries(rows.map((r) => [r.playerId, r]));
    // court 100/2 = 50 each; expense 10 each; A −5 discount; games from games_played.
    expect(byId.A).toMatchObject({ court: 50, expense: 10, discount: 5, hours: 3, shuttles: 0, games: 7, total: 55 });
    expect(byId.B).toMatchObject({ court: 50, expense: 10, discount: 0, games: 4, total: 60 });
    expect(totalCourt).toBe(100);
    expect(totalExp).toBe(20);
    expect(totalDiscount).toBe(5);
    expect(grandTotal).toBe(115); // 55 + 60
    expect(totalShuttlesUsed).toBe(0); // no matches
  });
});

describe("computePlayerUsage — by_time (per-hour shuttle credit)", () => {
  // 18:00–20:00, 6 shuttles/hour. A plays both hours, B only hour 1.
  const club = {
    start_time: "18:00",
    end_time: "20:00",
    shuttle_split: "by_time",
    shuttle_hourly: [6, 6],
  } as Club;
  const players = [
    { id: "A", start_time: null, end_time: null }, // full 2h
    { id: "B", start_time: "18:00", end_time: "19:00" }, // hour 1 only
  ] as ClubPlayer[];

  it("credits each present player the slot's hourly count (NOT match-derived)", () => {
    const usage = computePlayerUsage({ club, players, matches: [] });
    expect(usage.get("A")).toEqual({ hours: 2, shuttles: 12 }); // 6 + 6
    expect(usage.get("B")).toEqual({ hours: 1, shuttles: 6 }); // hour 1 only
  });

  it("ignores rotation-queue matches entirely in by_time mode", () => {
    const usage = computePlayerUsage({
      club,
      players,
      matches: [
        {
          status: "completed",
          side_a_player1: "A",
          side_a_player2: "B",
          side_b_player1: null,
          side_b_player2: null,
          shuttles_used: 99,
        } as ClubMatch,
      ],
    });
    expect(usage.get("A")?.shuttles).toBe(12); // hourly, not 99 from the match
  });
});

describe("computeClubCostRows — by_time usage + total reconcile", () => {
  const club = {
    owner_id: "owner",
    court_fee: 0,
    court_split: "even",
    shuttle_split: "by_time",
    shuttle_price: 10,
    shuttle_hourly: [6, 6],
    start_time: "18:00",
    end_time: "20:00",
    court_gap_policy: "spread",
  } as Club;
  const players = [
    { id: "A", profile_id: null, start_time: null, end_time: null, games_played: 0, discount: 0 },
    { id: "B", profile_id: null, start_time: "18:00", end_time: "19:00", games_played: 0, discount: 0 },
  ] as ClubPlayer[];

  it("shuttles-used column reflects hourly counts; footer total = Σ shuttle_hourly", () => {
    const { rows, totalShuttlesUsed } = computeClubCostRows({
      club,
      players,
      matches: [], // no queue — the by_time use case
      expenses: [],
    });
    const byId = Object.fromEntries(rows.map((r) => [r.playerId, r]));
    // usage (full-credit): A both hours = 12, B hour 1 = 6
    expect(byId.A).toMatchObject({ shuttles: 12, shuttle: 90 }); // cost: hr1 60/2=30 + hr2 60/1=60
    expect(byId.B).toMatchObject({ shuttles: 6, shuttle: 30 }); // cost: hr1 60/2=30
    // footer = physical Σ hourly (once each), NOT the over-counting per-row sum
    expect(totalShuttlesUsed).toBe(12);
  });
});

describe("computePlayerUsage — even (manual total)", () => {
  const club = {
    start_time: "18:00",
    end_time: "21:00",
    shuttle_split: "even",
    shuttle_total: 40,
  } as Club;
  const players = [
    { id: "A", start_time: null, end_time: null }, // full 3h
    { id: "B", start_time: "19:00", end_time: "21:00" }, // 2h — still credited full 40
  ] as ClubPlayer[];

  function m(ids: (string | null)[], shuttles: number): ClubMatch {
    return {
      status: "completed",
      side_a_player1: ids[0] ?? null,
      side_a_player2: ids[1] ?? null,
      side_b_player1: ids[2] ?? null,
      side_b_player2: ids[3] ?? null,
      shuttles_used: shuttles,
    } as ClubMatch;
  }

  it("credits the full manual total to every player, ignoring matches (mirrors by_time)", () => {
    const usage = computePlayerUsage({ club, players, matches: [m(["A", "B"], 3)] });
    expect(usage.get("A")).toEqual({ hours: 3, shuttles: 40 });
    expect(usage.get("B")).toEqual({ hours: 2, shuttles: 40 }); // full 40 despite only 2h
  });

  it("shuttle_total 0 falls back to match-derived usage", () => {
    const usage = computePlayerUsage({
      club: { ...club, shuttle_total: 0 } as Club,
      players,
      matches: [m(["A", "B"], 3)],
    });
    expect(usage.get("A")?.shuttles).toBe(3);
    expect(usage.get("B")?.shuttles).toBe(3);
  });
});

describe("computeClubCostRows — even manual total (column + footer)", () => {
  const club = {
    owner_id: "owner",
    court_fee: 0,
    court_split: "even",
    shuttle_split: "even",
    shuttle_price: 10,
    shuttle_total: 40,
    start_time: "18:00",
    end_time: "21:00",
    court_gap_policy: "spread",
  } as Club;
  const players = [
    { id: "A", profile_id: null, start_time: null, end_time: null, games_played: 0, discount: 0 },
    { id: "B", profile_id: null, start_time: null, end_time: null, games_played: 0, discount: 0 },
  ] as ClubPlayer[];

  it("shuttles column = manual total per player; footer = manual total; cost splits it evenly", () => {
    const { rows, totalShuttle, totalShuttlesUsed } = computeClubCostRows({
      club,
      players,
      matches: [], // no queue used — bill the manual 40 shuttles
      expenses: [],
    });
    const byId = Object.fromEntries(rows.map((r) => [r.playerId, r]));
    // cost 40 × 10 = 400 ÷ 2 = 200 each; display column = 40 each (full credit)
    expect(byId.A).toMatchObject({ shuttles: 40, shuttle: 200 });
    expect(byId.B).toMatchObject({ shuttles: 40, shuttle: 200 });
    expect(totalShuttle).toBe(400);
    expect(totalShuttlesUsed).toBe(40); // footer = the manual total (like by_time)
  });
});
