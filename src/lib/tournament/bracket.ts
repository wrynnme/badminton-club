export function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export type BracketEntry = {
  teamId: string | null;
  label: string;
};

export type BracketMatchDef = {
  id: string;
  roundNumber: number;
  matchNumber: number;
  teamAId: string | null;
  teamBId: string | null;
  nextMatchId: string | null;
  nextMatchSlot: "a" | "b" | null;
  loserNextMatchId: string | null;
  loserNextMatchSlot: "a" | "b" | null;
  bracket: "upper" | "lower" | "grand_final";
  isBye: boolean;
};

// Standard bracket slot arrangement: seed 1 meets seed 2 only in the final.
function bracketSlots(n: number): number[] {
  if (n === 1) return [0];
  const half = n / 2;
  const upper = bracketSlots(half);
  const lower = upper.map((i) => n - 1 - i);
  const result: number[] = [];
  for (let i = 0; i < upper.length; i++) result.push(upper[i], lower[i]);
  return result;
}

export function buildBracket(entries: BracketEntry[]): BracketMatchDef[] {
  const n = entries.length; // must be power of 2
  const totalRounds = Math.log2(n);
  const slots = bracketSlots(n);
  const arranged = slots.map((i) => entries[i]);

  const roundIds: string[][] = [];
  for (let r = 1; r <= totalRounds; r++) {
    const count = n / Math.pow(2, r);
    roundIds.push(Array.from({ length: count }, () => crypto.randomUUID()));
  }

  const all: BracketMatchDef[] = [];
  let matchNum = 1;

  for (let r = 1; r <= totalRounds; r++) {
    const ids = roundIds[r - 1];
    const nextIds = r < totalRounds ? roundIds[r] : null;

    for (let m = 0; m < ids.length; m++) {
      const nextMatchId = nextIds ? nextIds[Math.floor(m / 2)] : null;
      const nextMatchSlot: "a" | "b" | null = nextIds ? (m % 2 === 0 ? "a" : "b") : null;

      let teamAId: string | null = null;
      let teamBId: string | null = null;
      if (r === 1) {
        teamAId = arranged[m * 2]?.teamId ?? null;
        teamBId = arranged[m * 2 + 1]?.teamId ?? null;
      }

      const isBye = r === 1 && (teamAId === null || teamBId === null);

      all.push({
        id: ids[m], roundNumber: r, matchNumber: matchNum++,
        teamAId, teamBId, nextMatchId, nextMatchSlot,
        loserNextMatchId: null, loserNextMatchSlot: null,
        bracket: "upper", isBye,
      });
    }
  }

  return all;
}

// Full double-elimination bracket.
// Returns flat array of all matches: upper + lower + grand final.
// Lower bracket: 2*(log2(n)-1) rounds, alternating consolidation and drop-in.
// Grand final: upper winner (slot a) vs lower winner (slot b).
export function buildDoubleBracket(entries: BracketEntry[]): BracketMatchDef[] {
  const n = entries.length; // power of 2, n >= 4
  const totalUpperRounds = Math.log2(n);

  // Lower bracket round count = 2*(totalUpperRounds-1)
  // Sizes alternate: [n/4, n/4, n/8, n/8, ..., 1, 1]
  const lowerRoundSizes: number[] = [];
  let sz = n / 4;
  while (sz >= 1) {
    lowerRoundSizes.push(sz, sz);
    sz = Math.floor(sz / 2);
  }
  const totalLowerRounds = lowerRoundSizes.length;

  // Pre-assign all IDs
  const upperRoundIds: string[][] = [];
  for (let r = 1; r <= totalUpperRounds; r++) {
    upperRoundIds.push(Array.from({ length: n / Math.pow(2, r) }, () => crypto.randomUUID()));
  }
  const lowerRoundIds: string[][] = lowerRoundSizes.map((count) =>
    Array.from({ length: count }, () => crypto.randomUUID())
  );
  const grandFinalId = crypto.randomUUID();

  const all: BracketMatchDef[] = [];
  let matchNum = 1;

  // ── Upper bracket ──
  const slots = bracketSlots(n);
  const arranged = slots.map((i) => entries[i]);

  for (let r = 1; r <= totalUpperRounds; r++) {
    const ids = upperRoundIds[r - 1];
    const nextUpperIds = r < totalUpperRounds ? upperRoundIds[r] : null;

    for (let m = 0; m < ids.length; m++) {
      // Winner advance: next upper round, or grand final (slot 'a') from upper final
      const nextMatchId = nextUpperIds ? nextUpperIds[Math.floor(m / 2)] : grandFinalId;
      const nextMatchSlot: "a" | "b" = nextUpperIds ? (m % 2 === 0 ? "a" : "b") : "a";

      // Loser route to lower bracket
      let loserNextMatchId: string | null = null;
      let loserNextMatchSlot: "a" | "b" | null = null;

      if (r === 1) {
        // UR1 losers → LR1 (lr=0): two losers per LR1 match
        loserNextMatchId = lowerRoundIds[0][Math.floor(m / 2)];
        loserNextMatchSlot = m % 2 === 0 ? "a" : "b";
      } else if (r < totalUpperRounds) {
        // URr losers → drop round lr = 2*(r-1)-1, one loser per drop match (slot 'a')
        const dropLrIdx = 2 * (r - 1) - 1;
        loserNextMatchId = lowerRoundIds[dropLrIdx][m];
        loserNextMatchSlot = "a";
      } else {
        // Upper final loser → lower final (LF = last lower round, slot 'a')
        loserNextMatchId = lowerRoundIds[totalLowerRounds - 1][0];
        loserNextMatchSlot = "a";
      }

      let teamAId: string | null = null;
      let teamBId: string | null = null;
      if (r === 1) {
        teamAId = arranged[m * 2]?.teamId ?? null;
        teamBId = arranged[m * 2 + 1]?.teamId ?? null;
      }

      const isBye = r === 1 && (teamAId === null || teamBId === null);

      all.push({
        id: ids[m], roundNumber: r, matchNumber: matchNum++,
        teamAId, teamBId, nextMatchId, nextMatchSlot,
        loserNextMatchId, loserNextMatchSlot,
        bracket: "upper", isBye,
      });
    }
  }

  // ── Lower bracket ──
  for (let lr = 0; lr < totalLowerRounds; lr++) {
    const ids = lowerRoundIds[lr];
    const isLast = lr === totalLowerRounds - 1;

    for (let m = 0; m < ids.length; m++) {
      let nextMatchId: string;
      let nextMatchSlot: "a" | "b";

      if (isLast) {
        // Lower final → grand final slot 'b'
        nextMatchId = grandFinalId;
        nextMatchSlot = "b";
      } else if (lr % 2 === 0) {
        // Even lr (LR1, LR3 …): consolidation → next drop round, slot 'b' (1:1)
        nextMatchId = lowerRoundIds[lr + 1][m];
        nextMatchSlot = "b";
      } else {
        // Odd lr (LR2, LR4 …): drop round → next consolidation, 2:1
        nextMatchId = lowerRoundIds[lr + 1][Math.floor(m / 2)];
        nextMatchSlot = m % 2 === 0 ? "a" : "b";
      }

      all.push({
        id: ids[m], roundNumber: lr + 1, matchNumber: matchNum++,
        teamAId: null, teamBId: null, nextMatchId, nextMatchSlot,
        loserNextMatchId: null, loserNextMatchSlot: null,
        bracket: "lower", isBye: false,
      });
    }
  }

  // ── Grand final ──
  all.push({
    id: grandFinalId,
    roundNumber: totalLowerRounds + 1,
    matchNumber: matchNum,
    teamAId: null, teamBId: null,
    nextMatchId: null, nextMatchSlot: null,
    loserNextMatchId: null, loserNextMatchSlot: null,
    bracket: "grand_final", isBye: false,
  });

  return all;
}

export function roundLabel(roundNumber: number, maxRound: number, bracketSize: number): string {
  if (roundNumber === maxRound) return "รอบชิงชนะเลิศ";
  if (roundNumber === maxRound - 1) return "รอบรองชนะเลิศ";
  if (roundNumber === maxRound - 2 && maxRound >= 4) return "รอบก่อนรองชนะเลิศ";
  const teamsInRound = bracketSize / Math.pow(2, roundNumber - 1);
  return `รอบ ${teamsInRound} ทีม`;
}

export function lowerRoundLabel(roundNumber: number, totalLowerRounds: number): string {
  if (roundNumber === totalLowerRounds) return "Lower Final";
  return `สายล่าง รอบ ${roundNumber}`;
}
