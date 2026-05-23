import type { Match } from "@/lib/types";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";

export type EntityType = "player" | "pair" | "team" | "division";

export type EntityStats = {
  entityType: EntityType;
  entityId: string;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number; // 0..1
  pointsFor: number;
  pointsAgainst: number;
  pointsDiff: number;
  streak: { type: "W" | "L" | "D" | null; length: number }; // latest streak
  matches: Match[]; // chronological (oldest → newest by match_number)
  headToHead: Map<
    string,
    { played: number; wins: number; losses: number; draws: number }
  >; // opponentId → stats
};

/**
 * Compute per-pair stats from a list of tournament matches.
 * Pure function — no DB, no React.
 */
export function computePairStats(opts: {
  pairId: string;
  matches: Match[];
}): EntityStats {
  const { pairId, matches } = opts;

  // Filter to completed matches involving this pair, sorted oldest→newest
  const relevant = matches
    .filter(
      (m) =>
        m.status === "completed" &&
        (m.pair_a_id === pairId || m.pair_b_id === pairId)
    )
    .sort((a, b) => a.match_number - b.match_number);

  let wins = 0;
  let losses = 0;
  let draws = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  const headToHead = new Map<
    string,
    { played: number; wins: number; losses: number; draws: number }
  >();

  for (const m of relevant) {
    const isSideA = m.pair_a_id === pairId;
    const opponentId = isSideA ? m.pair_b_id : m.pair_a_id;

    const rawWinner = gameWinner(m.games);
    const totals = sumGameScores(m.games);

    // Accumulate points from this pair's perspective
    if (isSideA) {
      pointsFor += totals.a;
      pointsAgainst += totals.b;
    } else {
      pointsFor += totals.b;
      pointsAgainst += totals.a;
    }

    // Determine W/L/D for this pair
    let result: "W" | "L" | "D";
    if (rawWinner === "draw") {
      result = "D";
      draws++;
    } else if ((rawWinner === "a" && isSideA) || (rawWinner === "b" && !isSideA)) {
      result = "W";
      wins++;
    } else {
      result = "L";
      losses++;
    }

    // Head-to-head accumulation (skip null opponents, e.g. BYE)
    if (opponentId) {
      const existing = headToHead.get(opponentId) ?? {
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      };
      existing.played++;
      if (result === "W") existing.wins++;
      else if (result === "L") existing.losses++;
      else existing.draws++;
      headToHead.set(opponentId, existing);
    }
  }

  const played = wins + losses + draws;
  const winRate = played > 0 ? wins / played : 0;
  const pointsDiff = pointsFor - pointsAgainst;

  // Streak: scan matches in reverse; leading run of identical result type
  const streak = computeStreak(pairId, relevant);

  return {
    entityType: "pair",
    entityId: pairId,
    played,
    wins,
    losses,
    draws,
    winRate,
    pointsFor,
    pointsAgainst,
    pointsDiff,
    streak,
    matches: relevant,
    headToHead,
  };
}

function computeStreak(
  pairId: string,
  sortedMatches: Match[] // oldest→newest, all completed, all involving pairId
): { type: "W" | "L" | "D" | null; length: number } {
  if (sortedMatches.length === 0) return { type: null, length: 0 };

  // Walk from newest to oldest
  let streakType: "W" | "L" | "D" | null = null;
  let length = 0;

  for (let i = sortedMatches.length - 1; i >= 0; i--) {
    const m = sortedMatches[i];
    const isSideA = m.pair_a_id === pairId;
    const rawWinner = gameWinner(m.games);

    let result: "W" | "L" | "D";
    if (rawWinner === "draw") {
      result = "D";
    } else if ((rawWinner === "a" && isSideA) || (rawWinner === "b" && !isSideA)) {
      result = "W";
    } else {
      result = "L";
    }

    if (streakType === null) {
      streakType = result;
      length = 1;
    } else if (result === streakType) {
      length++;
    } else {
      break;
    }
  }

  return { type: streakType, length };
}
