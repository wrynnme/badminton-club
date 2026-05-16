/**
 * Generate round-robin matches between two sides.
 * Returns ordered list of [sideA_index, sideB_index] pairs.
 *
 * Balanced ordering: rotates sideB so consecutive matches don't
 * involve the same competitor when possible.
 */
export function balancedRoundRobin(sizeA: number, sizeB: number): Array<[number, number]> {
  if (sizeA <= 0 || sizeB <= 0) return [];

  const matches: Array<[number, number]> = [];
  // Iterate `a` over the FULL sizeA so no row is dropped when sizeA > sizeB.
  // `b = (a + round) % sizeB` rotates each round so consecutive matches
  // tend to involve different sideB competitors.
  const totalPairs = sizeA * sizeB;
  const seen = new Set<string>();

  // We need enough rounds to cover every (a, b) pair; sizeB rounds suffice
  // because for a fixed a, b cycles through all sizeB values across rounds.
  for (let round = 0; round < sizeB && matches.length < totalPairs; round++) {
    for (let a = 0; a < sizeA; a++) {
      const b = (a + round) % sizeB;
      const key = `${a}-${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push([a, b]);
      if (matches.length === totalPairs) break;
    }
  }

  return matches;
}

/**
 * Generate matches for pair-mode tournament.
 * Every pair from team X plays every pair from team Y, for every team pairing.
 * Returns ordered list of { teamA, teamB, pairAIdx, pairBIdx }.
 */
export function generateAllPairMatches(
  teamPairs: Array<{ teamId: string; pairIds: string[] }>
): Array<{ teamAId: string; teamBId: string; pairAId: string; pairBId: string }> {
  const out: Array<{ teamAId: string; teamBId: string; pairAId: string; pairBId: string }> = [];

  for (let i = 0; i < teamPairs.length; i++) {
    for (let j = i + 1; j < teamPairs.length; j++) {
      const a = teamPairs[i];
      const b = teamPairs[j];
      const schedule = balancedRoundRobin(a.pairIds.length, b.pairIds.length);
      for (const [aIdx, bIdx] of schedule) {
        out.push({
          teamAId: a.teamId,
          teamBId: b.teamId,
          pairAId: a.pairIds[aIdx],
          pairBId: b.pairIds[bIdx],
        });
      }
    }
  }

  return out;
}
