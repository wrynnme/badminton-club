import type { Match } from "@/lib/types";

export const CARD_H = 80; // px — height of each match card
export const CONNECTOR_W = 28; // px — horizontal connector width

export type VisualRound = {
  roundNumber: number;
  label: string;
  slotHeight: number; // px per slot
  matches: Array<Match | null>; // null = empty/bye slot
};

function roundLabel(roundsFromFinal: number, totalRounds: number): string {
  if (roundsFromFinal === 0) return "รอบชิงชนะเลิศ";
  if (roundsFromFinal === 1 && totalRounds > 2) return "รอบรองชนะเลิศ";
  if (roundsFromFinal === 2 && totalRounds > 3) return "รอบ 8 ทีม";
  if (roundsFromFinal === 3 && totalRounds > 4) return "รอบ 16 ทีม";
  return `รอบที่ ${totalRounds - roundsFromFinal}`;
}

export function buildVisualBracket(
  matches: Match[],
  section: "upper" | "lower" | "grand_final"
): VisualRound[] {
  const sectionMatches = matches.filter(
    (m) => (m.bracket ?? "upper") === section
  );
  if (!sectionMatches.length) return [];

  const byRound = new Map<number, Match[]>();
  for (const m of sectionMatches) {
    const k = m.round_number;
    if (!byRound.has(k)) byRound.set(k, []);
    byRound.get(k)!.push(m);
  }

  const roundNumbers = [...byRound.keys()].sort((a, b) => a - b);
  const totalRounds = roundNumbers.length;
  const firstRoundCount = byRound.get(roundNumbers[0])!.length;

  return roundNumbers.map((rn, idx) => {
    const rMatches = byRound.get(rn)!.sort((a, b) => a.match_number - b.match_number);
    // Number of slots shrinks each round
    const slotCount = Math.max(1, Math.round(firstRoundCount / Math.pow(2, idx)));
    const slotHeight = CARD_H * Math.pow(2, idx);

    const slots: Array<Match | null> = Array(slotCount).fill(null);
    rMatches.forEach((m, i) => { if (i < slotCount) slots[i] = m; });

    return {
      roundNumber: rn,
      label: roundLabel(totalRounds - 1 - idx, totalRounds),
      slotHeight,
      matches: slots,
    };
  });
}
