export type ClassPair = { pairId: string; teamId: string };

export type GroupingResult =
  | { ok: true; groups: string[][] } // groups[i] = array of pairIds assigned to group i
  | { ok: false; error: string }; // infeasibility — Thai message

/**
 * Assign a class's pairs into balanced groups with the CROSS-TEAM RULE:
 * no two pairs from the same team land in the same group, while keeping
 * group sizes as even as possible. Deterministic (no Math.random / Date).
 */
export function balancedTeamGroupAssignment(
  pairs: ClassPair[],
  pairsPerGroup: number,
): GroupingResult {
  // Step 1: validate pairsPerGroup
  if (pairsPerGroup < 1) {
    return { ok: false, error: "pairs_per_group ต้องมากกว่า 0" };
  }

  // Step 2: empty input
  if (pairs.length === 0) {
    return { ok: true, groups: [] };
  }

  // Step 3: bucket pairs by teamId
  const buckets = new Map<string, string[]>();
  for (const { pairId, teamId } of pairs) {
    let bucket = buckets.get(teamId);
    if (!bucket) {
      bucket = [];
      buckets.set(teamId, bucket);
    }
    bucket.push(pairId);
  }

  // Step 4: compute groupCount
  const groupCount = Math.ceil(pairs.length / pairsPerGroup);

  // Step 5: feasibility check — iterate teams in teamId-ascending order
  const sortedTeamIds = Array.from(buckets.keys()).sort();
  for (const teamId of sortedTeamIds) {
    const count = buckets.get(teamId)!.length;
    if (count > groupCount) {
      return {
        ok: false,
        error: `ทีม ${teamId} ส่ง ${count} คู่ เกินจำนวนกลุ่ม (${groupCount}) — เพิ่ม pairs_per_group หรือลดคู่`,
      };
    }
  }

  // Step 6: sort teams by bucket size DESC, tie-break by teamId ASC
  const sortedTeams = sortedTeamIds.slice().sort((a, b) => {
    const diff = buckets.get(b)!.length - buckets.get(a)!.length;
    if (diff !== 0) return diff;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  // Step 7: initialize groupCount empty arrays
  const groups: string[][] = Array.from({ length: groupCount }, () => []);

  // Step 8: greedy assignment
  for (const teamId of sortedTeams) {
    const teamPairs = buckets.get(teamId)!;
    // Track which groups already contain a pair from this team
    const teamInGroup = new Set<number>();

    for (const pairId of teamPairs) {
      // Find the group with the fewest pairs that doesn't already have this team
      let bestIdx = -1;
      let bestSize = Infinity;
      for (let g = 0; g < groupCount; g++) {
        if (teamInGroup.has(g)) continue;
        const size = groups[g].length;
        if (size < bestSize) {
          bestSize = size;
          bestIdx = g;
        }
      }
      // Feasibility guarantees bestIdx !== -1
      groups[bestIdx].push(pairId);
      teamInGroup.add(bestIdx);
    }
  }

  // Step 9: return
  return { ok: true, groups };
}
