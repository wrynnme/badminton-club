/**
 * Generate round-robin matches between two sides.
 * Returns ordered list of [sideA_index, sideB_index] pairs.
 *
 * Balanced ordering: rotates sideB so consecutive matches don't
 * involve the same competitor when possible.
 */
export function balancedRoundRobin(sizeA: number, sizeB: number): Array<[number, number]> {
  const matches: Array<[number, number]> = [];
  const maxRound = Math.max(sizeA, sizeB);

  for (let round = 0; round < maxRound; round++) {
    for (let i = 0; i < Math.min(sizeA, sizeB); i++) {
      const a = i;
      const b = (i + round) % sizeB;
      matches.push([a, b]);
    }
  }

  // Dedupe (when sizeA < sizeB, rotation creates duplicates after sizeA rounds)
  const seen = new Set<string>();
  const unique: Array<[number, number]> = [];
  for (const [a, b] of matches) {
    const key = `${a}-${b}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push([a, b]);
    }
    if (unique.length === sizeA * sizeB) break;
  }

  return unique;
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
