import { describe, it, expect } from "vitest";
import type { Match } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";
import { computePrizeResult, parsePrizeTemplate } from "@/lib/tournament/prizes";

function mkMatch(p: Partial<Match>): Match {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    tournament_id: "t",
    group_id: null,
    class_id: null,
    round_type: "knockout",
    round_number: 1,
    match_number: 1,
    team_a_id: null,
    team_b_id: null,
    pair_a_id: null,
    pair_b_id: null,
    team_a_score: null,
    team_b_score: null,
    games: [],
    winner_id: null,
    status: "pending",
    court: null,
    scheduled_at: null,
    next_match_id: null,
    next_match_slot: null,
    loser_next_match_id: null,
    loser_next_match_slot: null,
    bracket: "upper",
    division: null,
    queue_position: null,
    started_at: null,
    created_at: "2026-01-01",
    ...p,
  };
}

function comp(...ids: string[]): Map<string, Competitor> {
  return new Map(ids.map((id) => [id, { id, name: id.toUpperCase() }]));
}

describe("computePrizeResult — single elimination (pair mode)", () => {
  // SF1: P1 beats P2 → FINAL.a ; SF2: P3 beats P4 → FINAL.b ; FINAL: P1 beats P3
  const FINAL = "final";
  const matches: Match[] = [
    mkMatch({ id: "sf1", round_number: 1, next_match_id: FINAL, pair_a_id: "p1", pair_b_id: "p2", winner_id: "p1", status: "completed", games: [{ a: 21, b: 10 }] }),
    mkMatch({ id: "sf2", round_number: 1, next_match_id: FINAL, pair_a_id: "p3", pair_b_id: "p4", winner_id: "p3", status: "completed", games: [{ a: 21, b: 15 }] }),
    mkMatch({ id: FINAL, round_number: 2, next_match_id: null, pair_a_id: "p1", pair_b_id: "p3", winner_id: "p1", status: "completed", games: [{ a: 21, b: 18 }] }),
  ];

  it("derives champion + runner-up from the final", () => {
    const r = computePrizeResult(matches, comp("p1", "p2", "p3", "p4"));
    expect(r.hasBracket).toBe(true);
    expect(r.finalDecided).toBe(true);
    expect(r.champion?.id).toBe("p1");
    expect(r.runnerUp?.id).toBe("p3");
  });

  it("lists both semifinal losers as semifinalists", () => {
    const r = computePrizeResult(matches, comp("p1", "p2", "p3", "p4"));
    expect(r.semifinalists.map((c) => c.id).sort()).toEqual(["p2", "p4"]);
  });
});

describe("computePrizeResult — edge cases", () => {
  it("final still pending → no champion/runner-up but semifinalists known", () => {
    const matches: Match[] = [
      mkMatch({ id: "sf1", round_number: 1, next_match_id: "f", pair_a_id: "p1", pair_b_id: "p2", winner_id: "p1", status: "completed" }),
      mkMatch({ id: "sf2", round_number: 1, next_match_id: "f", pair_a_id: "p3", pair_b_id: "p4", winner_id: "p3", status: "completed" }),
      mkMatch({ id: "f", round_number: 2, next_match_id: null, pair_a_id: "p1", pair_b_id: "p3", status: "pending" }),
    ];
    const r = computePrizeResult(matches, comp("p1", "p2", "p3", "p4"));
    expect(r.finalDecided).toBe(false);
    expect(r.champion).toBeNull();
    expect(r.runnerUp).toBeNull();
    expect(r.semifinalists.map((c) => c.id).sort()).toEqual(["p2", "p4"]);
  });

  it("no knockout bracket (group only) → hasBracket false", () => {
    const matches: Match[] = [
      mkMatch({ id: "g1", round_type: "group", bracket: null, status: "completed", winner_id: "p1", pair_a_id: "p1", pair_b_id: "p2" }),
    ];
    const r = computePrizeResult(matches, comp("p1", "p2"));
    expect(r.hasBracket).toBe(false);
    expect(r.champion).toBeNull();
  });

  it("BYE feeder (null losing side) contributes no semifinalist", () => {
    const matches: Match[] = [
      // sf1 is a BYE: p1 vs nobody → p1 wins, no loser
      mkMatch({ id: "sf1", round_number: 1, next_match_id: "f", pair_a_id: "p1", pair_b_id: null, winner_id: "p1", status: "completed", games: [] }),
      mkMatch({ id: "sf2", round_number: 1, next_match_id: "f", pair_a_id: "p3", pair_b_id: "p4", winner_id: "p3", status: "completed" }),
      mkMatch({ id: "f", round_number: 2, next_match_id: null, pair_a_id: "p1", pair_b_id: "p3", winner_id: "p1", status: "completed" }),
    ];
    const r = computePrizeResult(matches, comp("p1", "p3", "p4"));
    expect(r.champion?.id).toBe("p1");
    expect(r.semifinalists.map((c) => c.id)).toEqual(["p4"]);
  });
});

describe("computePrizeResult — double elimination + team mode", () => {
  it("uses the grand_final as the terminal match", () => {
    const matches: Match[] = [
      mkMatch({ id: "uf", round_number: 2, bracket: "upper", next_match_id: "gf", pair_a_id: "p1", pair_b_id: "p2", winner_id: "p1", status: "completed" }),
      mkMatch({ id: "lf", round_number: 3, bracket: "lower", next_match_id: "gf", pair_a_id: "p3", pair_b_id: "p2", winner_id: "p2", status: "completed" }),
      mkMatch({ id: "gf", round_number: 4, bracket: "grand_final", next_match_id: null, pair_a_id: "p1", pair_b_id: "p2", winner_id: "p1", status: "completed" }),
    ];
    const r = computePrizeResult(matches, comp("p1", "p2", "p3"));
    expect(r.champion?.id).toBe("p1");
    expect(r.runnerUp?.id).toBe("p2");
    // feeders of gf = uf (loser p2) + lf (loser p3); p2 is the runner-up so it
    // must NOT also appear as a semifinalist → only p3 remains.
    expect(r.semifinalists.map((c) => c.id).sort()).toEqual(["p3"]);
  });

  it("resolves team-mode competitors via team_a_id/team_b_id", () => {
    const matches: Match[] = [
      mkMatch({ id: "sf1", round_number: 1, next_match_id: "f", team_a_id: "t1", team_b_id: "t2", winner_id: "t1", status: "completed" }),
      mkMatch({ id: "sf2", round_number: 1, next_match_id: "f", team_a_id: "t3", team_b_id: "t4", winner_id: "t4", status: "completed" }),
      mkMatch({ id: "f", round_number: 2, next_match_id: null, team_a_id: "t1", team_b_id: "t4", winner_id: "t4", status: "completed" }),
    ];
    const r = computePrizeResult(matches, comp("t1", "t2", "t3", "t4"));
    expect(r.champion?.id).toBe("t4");
    expect(r.runnerUp?.id).toBe("t1");
    expect(r.semifinalists.map((c) => c.id).sort()).toEqual(["t2", "t3"]);
  });
});

describe("parsePrizeTemplate", () => {
  it("drops malformed entries and sorts by rank", () => {
    const raw = [
      { rank: 2, label: "รองชนะเลิศ", cash: 5000, trophy: true },
      { rank: 1, label: "ชนะเลิศ", cash: 10000, trophy: true },
      { rank: 0, label: "bad rank" }, // rank < 1 → dropped
      { label: "no rank" }, // missing rank → dropped
      "garbage",
    ];
    const out = parsePrizeTemplate(raw);
    expect(out.map((e) => e.rank)).toEqual([1, 2]);
    expect(out[0].label).toBe("ชนะเลิศ");
    expect(out[1].cash).toBe(5000);
  });

  it("returns [] for non-array input", () => {
    expect(parsePrizeTemplate(null)).toEqual([]);
    expect(parsePrizeTemplate({})).toEqual([]);
  });
});
