import type { Match, PairWithPlayers } from "@/lib/types";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";

export type EntityType = "player" | "pair" | "team" | "division";

export type PartnerRecord = { played: number; wins: number; losses: number; draws: number };

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
  partnerBreakdown?: Map<string, PartnerRecord>; // playerId → stats (player entity only)
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
  const streak = computeStreak(relevant, (m) => m.pair_a_id === pairId);

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

/**
 * Compute the current streak from a sorted (oldest→newest) list of completed matches.
 * `isSideA` callback returns true when the entity of interest is on side A of the match.
 */
function computeStreak(
  sortedMatches: Match[],
  isSideA: (m: Match) => boolean
): { type: "W" | "L" | "D" | null; length: number } {
  if (sortedMatches.length === 0) return { type: null, length: 0 };

  // Walk from newest to oldest
  let streakType: "W" | "L" | "D" | null = null;
  let length = 0;

  for (let i = sortedMatches.length - 1; i >= 0; i--) {
    const m = sortedMatches[i];
    const sideA = isSideA(m);
    const rawWinner = gameWinner(m.games);

    let result: "W" | "L" | "D";
    if (rawWinner === "draw") {
      result = "D";
    } else if ((rawWinner === "a" && sideA) || (rawWinner === "b" && !sideA)) {
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

/**
 * Compute per-player stats from a list of tournament matches.
 * Aggregates across ALL pairs the player has played in.
 * Pure function — no DB, no React.
 */
export function computePlayerStats(opts: {
  playerId: string;
  pairs: PairWithPlayers[];
  matches: Match[];
}): EntityStats {
  const { playerId, pairs, matches } = opts;

  // All pair IDs for this player
  const playerPairIds = new Set(
    pairs
      .filter(
        (p) => p.player_id_1 === playerId || p.player_id_2 === playerId
      )
      .map((p) => p.id)
  );

  // Build quick lookup: pairId → the other player's id
  const pairPartnerMap = new Map<string, string | null>();
  for (const p of pairs) {
    if (p.player_id_1 === playerId || p.player_id_2 === playerId) {
      const partnerId =
        p.player_id_1 === playerId ? p.player_id_2 : p.player_id_1;
      pairPartnerMap.set(p.id, partnerId);
    }
  }

  const isSideA = (m: Match) =>
    playerPairIds.has(m.pair_a_id ?? "");

  // Filter to completed matches involving any of this player's pairs, oldest→newest
  const relevant = matches
    .filter(
      (m) =>
        m.status === "completed" &&
        (playerPairIds.has(m.pair_a_id ?? "") ||
          playerPairIds.has(m.pair_b_id ?? ""))
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
  const partnerBreakdown = new Map<
    string,
    { played: number; wins: number; losses: number; draws: number }
  >();

  for (const m of relevant) {
    const onSideA = isSideA(m);
    const activePairId = onSideA ? m.pair_a_id! : m.pair_b_id!;
    const opponentId = onSideA ? m.pair_b_id : m.pair_a_id;

    const rawWinner = gameWinner(m.games);
    const totals = sumGameScores(m.games);

    // Accumulate points from this player's perspective
    if (onSideA) {
      pointsFor += totals.a;
      pointsAgainst += totals.b;
    } else {
      pointsFor += totals.b;
      pointsAgainst += totals.a;
    }

    // Determine W/L/D
    let result: "W" | "L" | "D";
    if (rawWinner === "draw") {
      result = "D";
      draws++;
    } else if (
      (rawWinner === "a" && onSideA) ||
      (rawWinner === "b" && !onSideA)
    ) {
      result = "W";
      wins++;
    } else {
      result = "L";
      losses++;
    }

    // Head-to-head vs opponent pair
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

    // Partner breakdown — partner is the OTHER player in the active pair
    const partnerId = pairPartnerMap.get(activePairId) ?? null;
    if (partnerId) {
      const pb = partnerBreakdown.get(partnerId) ?? {
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      };
      pb.played++;
      if (result === "W") pb.wins++;
      else if (result === "L") pb.losses++;
      else pb.draws++;
      partnerBreakdown.set(partnerId, pb);
    }
  }

  const played = wins + losses + draws;
  const winRate = played > 0 ? wins / played : 0;
  const pointsDiff = pointsFor - pointsAgainst;

  const streak = computeStreak(relevant, isSideA);

  return {
    entityType: "player",
    entityId: playerId,
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
    partnerBreakdown,
  };
}
