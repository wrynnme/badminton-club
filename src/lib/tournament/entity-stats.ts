import type { Match, PairWithPlayers } from "@/lib/types";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";
import { computePairDivision, parsePairLevel } from "@/lib/tournament/divisions";

export type EntityType = "player" | "pair" | "team" | "division";

export type PartnerRecord = { played: number; wins: number; losses: number; draws: number };

export type HeadToHeadRecord = { played: number; wins: number; losses: number; draws: number };

/**
 * Base fields shared by every entity stats variant.
 *
 * `headToHead` is a plain object (Record) — not a Map — so views can iterate
 * with `Object.entries(...)` without first wrapping in `Array.from(...)`,
 * and so the value survives React server-component serialization without
 * extra glue.
 */
type StatsBase = {
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
  headToHead: Record<string, HeadToHeadRecord>; // opponentId → stats
};

export type PairStats = StatsBase & { entityType: "pair" };
export type PlayerStats = StatsBase & {
  entityType: "player";
  /** playerId → record. Required on PlayerStats (other entity types don't have partners). */
  partnerBreakdown: Record<string, PartnerRecord>;
};
export type TeamStats = StatsBase & { entityType: "team" };
export type DivisionStats = StatsBase & { entityType: "division" };

/**
 * Discriminated union over all entity stats variants. Narrow with `entityType`
 * to access variant-specific fields (e.g. `partnerBreakdown` on player).
 */
export type EntityStats = PairStats | PlayerStats | TeamStats | DivisionStats;

/**
 * Compute per-pair stats from a list of tournament matches.
 * Pure function — no DB, no React.
 */
export function computePairStats(opts: {
  pairId: string;
  matches: Match[];
}): PairStats {
  const { pairId, matches } = opts;

  // Filter to completed matches involving this pair, sorted oldest→newest.
  // Skip BYE walkovers (`games=[]`): gameWinner([]) returns "draw", which would
  // wrongly count BYE as a draw and bleed into streak. Matches scoring.ts's
  // null-opponent guard.
  const relevant = matches
    .filter(
      (m) =>
        m.status === "completed" &&
        m.games.length > 0 &&
        (m.pair_a_id === pairId || m.pair_b_id === pairId)
    )
    .sort((a, b) => a.match_number - b.match_number);

  let wins = 0;
  let losses = 0;
  let draws = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  const headToHead: Record<string, HeadToHeadRecord> = {};

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
      const existing = headToHead[opponentId] ?? {
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      };
      existing.played++;
      if (result === "W") existing.wins++;
      else if (result === "L") existing.losses++;
      else existing.draws++;
      headToHead[opponentId] = existing;
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
}): PlayerStats {
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

  // Filter to completed matches involving any of this player's pairs, oldest→newest.
  // Skip BYE walkovers (`games=[]`) — see computePairStats.
  const relevant = matches
    .filter(
      (m) =>
        m.status === "completed" &&
        m.games.length > 0 &&
        (playerPairIds.has(m.pair_a_id ?? "") ||
          playerPairIds.has(m.pair_b_id ?? ""))
    )
    .sort((a, b) => a.match_number - b.match_number);

  let wins = 0;
  let losses = 0;
  let draws = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  const headToHead: Record<string, HeadToHeadRecord> = {};
  const partnerBreakdown: Record<string, PartnerRecord> = {};

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
      const existing = headToHead[opponentId] ?? {
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      };
      existing.played++;
      if (result === "W") existing.wins++;
      else if (result === "L") existing.losses++;
      else existing.draws++;
      headToHead[opponentId] = existing;
    }

    // Partner breakdown — partner is the OTHER player in the active pair
    const partnerId = pairPartnerMap.get(activePairId) ?? null;
    if (partnerId) {
      const pb = partnerBreakdown[partnerId] ?? {
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      };
      pb.played++;
      if (result === "W") pb.wins++;
      else if (result === "L") pb.losses++;
      else pb.draws++;
      partnerBreakdown[partnerId] = pb;
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

/**
 * Compute aggregated stats for a team across ALL pairs that belong to the team.
 *
 * - entityId = teamId
 * - headToHead: keyed by OPPOSING TEAM id (not pair id). Built by mapping each
 *   opponent pair_id → team_id via `pairs`. Self-matches (both pairs in same team)
 *   are excluded.
 * - matches: all completed matches where any team pair participated, sorted oldest→newest.
 */
export function computeTeamStats(opts: {
  teamId: string;
  pairs: PairWithPlayers[];
  matches: Match[];
}): TeamStats {
  const { teamId, pairs, matches } = opts;

  // All pair IDs for this team
  const teamPairIds = new Set(
    pairs.filter((p) => p.team_id === teamId).map((p) => p.id)
  );

  // Build lookup: pairId → teamId (for opponent team resolution)
  const pairTeamMap = new Map<string, string>();
  for (const p of pairs) {
    pairTeamMap.set(p.id, p.team_id);
  }

  const isSideA = (m: Match) => teamPairIds.has(m.pair_a_id ?? "");

  // Filter: completed, involves at least one team pair, and not a BYE walkover.
  // Skip `games=[]` — see computePairStats.
  const relevant = matches
    .filter(
      (m) =>
        m.status === "completed" &&
        m.games.length > 0 &&
        (teamPairIds.has(m.pair_a_id ?? "") || teamPairIds.has(m.pair_b_id ?? ""))
    )
    .sort((a, b) => a.match_number - b.match_number);

  let wins = 0;
  let losses = 0;
  let draws = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  const headToHead: Record<string, HeadToHeadRecord> = {};

  for (const m of relevant) {
    const onSideA = isSideA(m);
    const opponentPairId = onSideA ? m.pair_b_id : m.pair_a_id;
    const opponentTeamId = opponentPairId ? pairTeamMap.get(opponentPairId) : undefined;

    // Skip intra-team matches (both pairs belong to same team)
    if (opponentTeamId === teamId) continue;

    const rawWinner = gameWinner(m.games);
    const totals = sumGameScores(m.games);

    if (onSideA) {
      pointsFor += totals.a;
      pointsAgainst += totals.b;
    } else {
      pointsFor += totals.b;
      pointsAgainst += totals.a;
    }

    let result: "W" | "L" | "D";
    if (rawWinner === "draw") {
      result = "D";
      draws++;
    } else if ((rawWinner === "a" && onSideA) || (rawWinner === "b" && !onSideA)) {
      result = "W";
      wins++;
    } else {
      result = "L";
      losses++;
    }

    // H2H keyed by opponent team id
    if (opponentTeamId) {
      const existing = headToHead[opponentTeamId] ?? {
        played: 0, wins: 0, losses: 0, draws: 0,
      };
      existing.played++;
      if (result === "W") existing.wins++;
      else if (result === "L") existing.losses++;
      else existing.draws++;
      headToHead[opponentTeamId] = existing;
    }
  }

  const played = wins + losses + draws;
  const winRate = played > 0 ? wins / played : 0;
  const pointsDiff = pointsFor - pointsAgainst;
  const streak = computeStreak(relevant, isSideA);

  return {
    entityType: "team",
    entityId: teamId,
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
 * Compute aggregated stats for a division (1..N) based on matches.division column.
 *
 * - entityId = String(division)
 * - headToHead: keyed by PAIR id → {played, wins, losses, draws} — per-pair standings
 *   within this division. This mirrors the view's "pair standings" section and is
 *   more meaningful than team-vs-team at division level.
 * - matches: all completed matches where division column === String(division).
 * - wins/losses/draws: aggregate across all match sides within division (each match
 *   contributes exactly one W + one L, or two D to the aggregate; these stats reflect
 *   total outcomes, not a single entity's record — use played/pointsFor/pointsAgainst
 *   for the division summary cards; wins/losses are intentionally mirrored).
 * - thresholds: used only to validate that `division` is within range; matches are
 *   filtered by the stored `m.division` column directly.
 */
export function computeDivisionStats(opts: {
  division: number;
  pairs: PairWithPlayers[];
  matches: Match[];
  thresholds: number[];
}): DivisionStats {
  const { division, pairs, matches, thresholds } = opts;

  const divStr = String(division);

  // Filter completed matches in this division using the stored column.
  // Skip BYE walkovers (`games=[]`) — see computePairStats.
  const relevant = matches
    .filter(
      (m) =>
        m.status === "completed" &&
        m.games.length > 0 &&
        m.division === divStr
    )
    .sort((a, b) => a.match_number - b.match_number);

  // Build set of pair IDs that belong to this division (via computePairDivision)
  const divisionPairIds = new Set<string>();
  if (thresholds.length > 0) {
    for (const p of pairs) {
      const d = computePairDivision(parsePairLevel(p.pair_level), thresholds);
      if (d === division) divisionPairIds.add(p.id);
    }
  }

  // Aggregate totals across all matches in division
  let pointsFor = 0;  // total points scored by side A across all matches
  let pointsAgainst = 0; // total points scored by side B across all matches

  // Per-pair standings: headToHead map keyed by pair_id → {played, wins, losses, draws}
  const headToHead: Record<string, HeadToHeadRecord> = {};

  const ensurePairEntry = (pairId: string): HeadToHeadRecord => {
    const existing = headToHead[pairId];
    if (existing) return existing;
    const fresh: HeadToHeadRecord = { played: 0, wins: 0, losses: 0, draws: 0 };
    headToHead[pairId] = fresh;
    return fresh;
  };

  let wins = 0;
  let losses = 0;
  let draws = 0;

  for (const m of relevant) {
    const rawWinner = gameWinner(m.games);
    const totals = sumGameScores(m.games);

    pointsFor += totals.a;
    pointsAgainst += totals.b;

    // Each completed match contributes either: one W + one L (decisive result),
    // or two D (draw, mirrored across both sides).
    if (rawWinner === "draw") {
      draws += 2;
    } else {
      wins++;
      losses++;
    }

    // Per-pair H2H (pair standings within division)
    if (m.pair_a_id) {
      const a = ensurePairEntry(m.pair_a_id);
      a.played++;
      if (rawWinner === "draw") a.draws++;
      else if (rawWinner === "a") a.wins++;
      else a.losses++;
    }
    if (m.pair_b_id) {
      const b = ensurePairEntry(m.pair_b_id);
      b.played++;
      if (rawWinner === "draw") b.draws++;
      else if (rawWinner === "a") b.losses++;
      else b.wins++;
    }
  }

  const played = relevant.length;
  const winRate = played > 0 ? wins / (wins + losses + draws) : 0;
  const pointsDiff = pointsFor - pointsAgainst;

  // Streak not meaningful at division level
  const streak: { type: "W" | "L" | "D" | null; length: number } = {
    type: null,
    length: 0,
  };

  return {
    entityType: "division",
    entityId: divStr,
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
