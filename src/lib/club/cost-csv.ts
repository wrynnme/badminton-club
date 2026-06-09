// CSV export of the club cost-breakdown table. Builds rows from the shared
// `computeClubCostRows` (the same source the on-screen tables render) and the
// shared CSV `csvRow` escaper, so the export can't drift from the display or
// from the tournament CSV conventions. Pure (string in/out).

import { computeClubCostRows, formatHours, type CostExpenseInput } from "@/lib/club/cost-summary";
import { csvRow } from "@/lib/export/csv";
import type { Club, ClubPlayer, ClubMatch } from "@/lib/types";

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
 */
export function generateClubCostCsv(input: {
  club: Club;
  players: ClubPlayer[];
  matches: ClubMatch[];
  expenses: CostExpenseInput[];
}): string {
  const { rows, totalCourt, totalShuttle, totalExp, totalDiscount, grandTotal } =
    computeClubCostRows(input);
  const nameById = new Map(input.players.map((p) => [p.id, p.display_name]));

  const lines = [csvRow(...HEADERS)];
  for (const r of rows) {
    lines.push(
      csvRow(
        nameById.get(r.playerId) ?? r.playerId,
        formatHours(r.hours),
        r.shuttles,
        r.court,
        r.shuttle,
        r.expense,
        r.discount,
        r.total,
      ),
    );
  }
  lines.push(csvRow("รวมทั้งหมด", "", "", totalCourt, totalShuttle, totalExp, totalDiscount, grandTotal));

  return lines.join("\n");
}
