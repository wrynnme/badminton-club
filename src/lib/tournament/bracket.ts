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
  isBye: boolean;
};

// Standard bracket slot arrangement: top seed meets bottom seed in R1,
// ensuring seeds 1 and 2 can only meet in the final.
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

  // Pre-assign IDs for all rounds
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

      all.push({ id: ids[m], roundNumber: r, matchNumber: matchNum++, teamAId, teamBId, nextMatchId, nextMatchSlot, isBye });
    }
  }

  return all;
}

export function roundLabel(roundNumber: number, maxRound: number, bracketSize: number): string {
  if (roundNumber === maxRound) return "รอบชิงชนะเลิศ";
  if (roundNumber === maxRound - 1) return "รอบรองชนะเลิศ";
  if (roundNumber === maxRound - 2 && maxRound >= 4) return "รอบก่อนรองชนะเลิศ";
  const teamsInRound = bracketSize / Math.pow(2, roundNumber - 1);
  return `รอบ ${teamsInRound} ทีม`;
}
