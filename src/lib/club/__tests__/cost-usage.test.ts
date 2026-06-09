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
