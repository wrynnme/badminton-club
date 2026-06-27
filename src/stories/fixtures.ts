// Shared Storybook fixtures for tournament domain components.
// `makeMatch` returns a fully-typed Match so stories only override the fields
// they care about (all DB-required fields are non-optional in the type).
import type { Match } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

export function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: "match-1",
    tournament_id: "tournament-1",
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
    bracket: null,
    division: null,
    queue_position: null,
    started_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Two sample pairs (green vs red) used across match/bracket/tv stories.
export const competitorA: Competitor = {
  id: "pair-a",
  name: "สมชาย / สมหญิง",
  color: "#16a34a",
  subtitle: "ทีมเสือ",
};

export const competitorB: Competitor = {
  id: "pair-b",
  name: "วิชัย / มานี",
  color: "#dc2626",
  subtitle: "ทีมสิงห์",
};

export const pairCompetitorMap = new Map<string, Competitor>([
  [competitorA.id, competitorA],
  [competitorB.id, competitorB],
]);

// A full best-of-3 result (A wins 2–1) reused by "completed" stories.
export const completedGames = [
  { a: 21, b: 15 },
  { a: 18, b: 21 },
  { a: 21, b: 19 },
];
