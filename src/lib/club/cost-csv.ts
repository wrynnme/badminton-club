// CSV export of the club cost-breakdown table. Recomputes from the SAME shared
// helpers the on-screen table uses (computeClubCostSummary + computePlayerUsage),
// so the exported numbers are identical to what's displayed. Pure (string in/out).

import {
  computeClubCostSummary,
  computePlayerUsage,
  playerSessionTotal,
  formatHours,
  type CostExpenseInput,
} from "@/lib/club/cost-summary";
import type { Club, ClubPlayer, ClubMatch } from "@/lib/types";

function esc(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADERS = [
  "ผู้เล่น",
  "ชั่วโมงที่เล่น",
  "ลูกที่ใช้",
  "ค่าสนาม",
  "ค่าลูก",
  "ค่าใช้จ่ายส่วนบุคคล",
  "ส่วนลด",
  "รวม",
] as const;

/**
 * One CSV string for the cost table: a header row, one row per player (in the
 * given player order), then a "รวมทั้งหมด" total row (the activity columns —
 * hours/shuttles — are left blank in the total, matching the on-screen footer).
 * Money rounding follows `computeClubSplit` (ceil per share).
 */
export function generateClubCostCsv(input: {
  club: Club;
  players: ClubPlayer[];
  matches: ClubMatch[];
  expenses: CostExpenseInput[];
}): string {
  const { club, players, matches, expenses } = input;

  const summary = computeClubCostSummary({ club, players, matches, expenses });
  const usage = computePlayerUsage({ club, players, matches });
  const nameById = new Map(players.map((p) => [p.id, p.display_name]));
  const discountById = new Map(players.map((p) => [p.id, p.discount ?? 0]));

  const lines: string[] = [HEADERS.map(esc).join(",")];

  for (const row of summary.rows) {
    const u = usage.get(row.playerId) ?? { hours: 0, shuttles: 0 };
    const exp = summary.expShareById.get(row.playerId) ?? 0;
    const disc = discountById.get(row.playerId) ?? 0;
    const total = playerSessionTotal({ court: row.court, shuttle: row.shuttle, expense: exp, discount: disc });
    lines.push(
      [
        esc(nameById.get(row.playerId) ?? row.playerId),
        esc(formatHours(u.hours)),
        esc(u.shuttles),
        esc(row.court),
        esc(row.shuttle),
        esc(exp),
        esc(disc),
        esc(total),
      ].join(","),
    );
  }

  lines.push(
    [
      esc("รวมทั้งหมด"),
      "",
      "",
      esc(summary.totalCourt),
      esc(summary.totalShuttle),
      esc(summary.totalExp),
      esc(summary.totalDiscount),
      esc(summary.grandTotal),
    ].join(","),
  );

  return lines.join("\n");
}
