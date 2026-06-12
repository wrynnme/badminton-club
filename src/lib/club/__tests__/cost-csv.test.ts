import { describe, it, expect } from "vitest";
import { generateClubCostCsv, type CostCsvLabels } from "@/lib/club/cost-csv";
import type { Club, ClubPlayer, ClubMatch } from "@/lib/types";

// Thai labels fixture — byte-identical to the original hardcoded strings so
// all assertions remain unchanged after the labels-param refactor.
const thLabels: CostCsvLabels = {
  colPlayer: "ผู้เล่น",
  colHours: "ชั่วโมงที่เล่น",
  colGames: "เกม",
  colShuttlesUsed: "ลูกที่ใช้",
  colCourtFee: "ค่าสนาม",
  colShuttleFee: "ค่าลูก",
  colExpense: "ค่าใช้จ่ายส่วนบุคคล",
  colDiscount: "ส่วนลด",
  colTotal: "รวม",
  grandTotal: "รวมทั้งหมด",
};

function club(overrides: Partial<Club> = {}): Club {
  return {
    name: "ก๊วนทดสอบ",
    play_date: "2026-06-09",
    owner_id: "owner-profile",
    court_fee: 100,
    court_split: "even",
    shuttle_split: "even",
    shuttle_price: 0,
    start_time: "18:00",
    end_time: "21:00",
    court_gap_policy: "spread",
    ...overrides,
  } as Club;
}

function player(id: string, extra: Partial<ClubPlayer> = {}): ClubPlayer {
  return {
    id,
    profile_id: null,
    display_name: id,
    start_time: null,
    end_time: null,
    games_played: 0,
    discount: 0,
    ...extra,
  } as ClubPlayer;
}

describe("generateClubCostCsv", () => {
  it("header + one row per player + a blank-activity total row", () => {
    const csv = generateClubCostCsv({
      club: club(),
      players: [player("A"), player("B")],
      matches: [],
      expenses: [],
    }, thLabels);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "ผู้เล่น,ชั่วโมงที่เล่น,เกม,ลูกที่ใช้,ค่าสนาม,ค่าลูก,ค่าใช้จ่ายส่วนบุคคล,ส่วนลด,รวม",
    );
    expect(lines).toHaveLength(4); // header + 2 players + total
    // court 100 even / 2 = 50 each; full 3h window, 0 games, 0 shuttles.
    expect(lines[1]).toBe("A,3,0,0,50,0,0,0,50");
    expect(lines[2]).toBe("B,3,0,0,50,0,0,0,50");
    // total row: hours/games blank; ลูกที่ใช้ = physical total (0); money summed.
    expect(lines[3]).toBe("รวมทั้งหมด,,,0,100,0,0,0,100");
  });

  it("ceil over-collect is reflected (court 100 ÷ 3 → 34 each, total 102)", () => {
    const csv = generateClubCostCsv({
      club: club(),
      players: [player("A"), player("B"), player("C")],
      matches: [],
      expenses: [],
    }, thLabels);
    const lines = csv.split("\n");
    expect(lines[1]).toBe("A,3,0,0,34,0,0,0,34");
    expect(lines[4]).toBe("รวมทั้งหมด,,,0,102,0,0,0,102");
  });

  it("escapes a name containing a comma", () => {
    const csv = generateClubCostCsv({
      club: club({ court_fee: 0 }),
      players: [player("a,b")],
      matches: [],
      expenses: [],
    }, thLabels);
    expect(csv.split("\n")[1]).toBe('"a,b",3,0,0,0,0,0,0,0');
  });

  it("includes shuttles used; total row shows the physical shuttle total", () => {
    const m = {
      status: "completed",
      side_a_player1: "A",
      side_a_player2: null,
      side_b_player1: "B",
      side_b_player2: null,
      shuttles_used: 2,
    } as ClubMatch;
    const csv = generateClubCostCsv({
      club: club({ court_fee: 0, shuttle_price: 20, shuttle_split: "even" }),
      players: [player("A"), player("B")],
      matches: [m],
      expenses: [],
    }, thLabels);
    const lines = csv.split("\n");
    // ลูกที่ใช้ column is now index 3 (after name, hours, games); full-credit = 2 each.
    expect(lines[1].split(",")[3]).toBe("2");
    expect(lines[2].split(",")[3]).toBe("2");
    // total row ลูกที่ใช้ = physical total (Σ shuttles_used = 2), not 2+2.
    expect(lines[3].split(",")[3]).toBe("2");
  });
});
