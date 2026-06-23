import { describe, it, expect } from "vitest";
import { computeClubCostSummary } from "@/lib/club/cost-summary";

type SummaryInput = Parameters<typeof computeClubCostSummary>[0];

const baseClub: SummaryInput["club"] = {
  owner_id: "owner-profile",
  court_fee: 120,
  court_split: "even",
  shuttle_split: "even",
  shuttle_price: 10,
  shuttle_hourly: [],
  start_time: "19:00",
  end_time: "21:00",
  court_gap_policy: "spread",
};

// p1 is the owner (profile_id matches club.owner_id); both play the full window.
const players = (discounts: Record<string, number> = {}): SummaryInput["players"] => [
  { id: "p1", profile_id: "owner-profile", start_time: null, end_time: null, games_played: 1, discount: discounts.p1 ?? 0 },
  { id: "p2", profile_id: "guest", start_time: null, end_time: null, games_played: 1, discount: discounts.p2 ?? 0 },
];

// one completed singles match, p1 vs p2, 3 shuttles
const matches: SummaryInput["matches"] = [
  { status: "completed", side_a_player1: "p1", side_a_player2: null, side_b_player1: "p2", side_b_player2: null, shuttles_used: 3 },
];

describe("computeClubCostSummary", () => {
  it("even court + even shuttle, no expenses/discounts", () => {
    const s = computeClubCostSummary({ club: baseClub, players: players(), matches, expenses: [] });
    // court 120/2 = 60 each; shuttle 3×10=30 /2 = 15 each
    expect(s.totalCourt).toBe(120);
    expect(s.totalShuttle).toBe(30);
    expect(s.totalExp).toBe(0);
    expect(s.totalDiscount).toBe(0);
    expect(s.grandTotal).toBe(150); // (60+15) + (60+15)
  });

  it("subtracts per-player discount (floored at 0 per player)", () => {
    const s = computeClubCostSummary({ club: baseClub, players: players({ p1: 20 }), matches, expenses: [] });
    expect(s.totalDiscount).toBe(20);
    expect(s.grandTotal).toBe(130); // max(0,75-20)=55 + 75
  });

  it("caps an over-large discount at the player's subtotal so totals reconcile (P1-B)", () => {
    // p1 subtotal = 60 court + 15 shuttle = 75; a 200 discount must not count beyond 75.
    const s = computeClubCostSummary({ club: baseClub, players: players({ p1: 200 }), matches, expenses: [] });
    expect(s.totalDiscount).toBe(75); // min(200, 75) + min(0, 75)
    expect(s.grandTotal).toBe(75); // max(0, 75-200)=0 + 75
    // footer must reconcile: court + shuttle + expense − discount === grandTotal
    expect(s.totalCourt + s.totalShuttle + s.totalExp - s.totalDiscount).toBe(s.grandTotal);
  });

  it("adds personal expenses (empty payer list = all players)", () => {
    const s = computeClubCostSummary({
      club: baseClub,
      players: players(),
      matches,
      expenses: [{ amount: 40, payer_player_ids: [] }],
    });
    expect(s.totalExp).toBe(40); // 20 each
    expect(s.grandTotal).toBe(190); // (60+15+20) + (60+15+20)
  });

  it("expense amount may arrive as a string", () => {
    const s = computeClubCostSummary({
      club: baseClub,
      players: players(),
      matches,
      expenses: [{ amount: "40", payer_player_ids: [] }],
    });
    expect(s.totalExp).toBe(40);
  });

  it("empty club (no players) → zero totals", () => {
    const s = computeClubCostSummary({ club: baseClub, players: [], matches: [], expenses: [] });
    expect(s.grandTotal).toBe(0);
    expect(s.totalCourt).toBe(0);
    expect(s.rows).toEqual([]);
  });
});
