// CSV export of the club cost-breakdown table. Builds rows from the shared
// `computeClubCostRows` (the same source the on-screen tables render) and the
// shared CSV `csvRow` escaper, so the export can't drift from the display or
// from the tournament CSV conventions. Pure (string in/out).

import { computeClubCostRows, formatHours, type CostExpenseInput } from "@/lib/club/cost-summary";
import { csvRow } from "@/lib/export/csv";
import type { Club, ClubPlayer, ClubMatch } from "@/lib/types";

// ── Label interface (caller builds from t(); lib stays pure) ──────────────────

export interface CostCsvLabels {
  /** Column header: player name */
  colPlayer: string;
  /** Column header: hours played */
  colHours: string;
  /** Column header: number of games */
  colGames: string;
  /** Column header: shuttles used */
  colShuttlesUsed: string;
  /** Column header: court fee */
  colCourtFee: string;
  /** Column header: shuttle fee */
  colShuttleFee: string;
  /** Column header: personal expense */
  colExpense: string;
  /** Column header: discount */
  colDiscount: string;
  /** Column header: total */
  colTotal: string;
  /** Total row label */
  grandTotal: string;
}

/**
 * One CSV string for the cost table: a header row, one row per player (in the
 * given player order), then a grand-total row (the activity columns —
 * hours/shuttles — are left blank in the total, matching the on-screen footer).
 */
export function generateClubCostCsv(
  input: {
    club: Club;
    players: ClubPlayer[];
    matches: ClubMatch[];
    expenses: CostExpenseInput[];
  },
  labels: CostCsvLabels,
): string {
  const { rows, totalCourt, totalShuttle, totalExp, totalDiscount, grandTotal, totalShuttlesUsed } =
    computeClubCostRows(input);
  const nameById = new Map(input.players.map((p) => [p.id, p.display_name]));

  const headers = [
    labels.colPlayer,
    labels.colHours,
    labels.colGames,
    labels.colShuttlesUsed,
    labels.colCourtFee,
    labels.colShuttleFee,
    labels.colExpense,
    labels.colDiscount,
    labels.colTotal,
  ];

  const lines = [csvRow(...headers)];
  for (const r of rows) {
    lines.push(
      csvRow(
        nameById.get(r.playerId) ?? r.playerId,
        formatHours(r.hours),
        r.games,
        r.shuttles,
        r.court,
        r.shuttle,
        r.expense,
        r.discount,
        r.total,
      ),
    );
  }
  // Total row: hours/games blank; shuttles = physical total (Σ shuttles_used).
  lines.push(
    csvRow(labels.grandTotal, "", "", totalShuttlesUsed, totalCourt, totalShuttle, totalExp, totalDiscount, grandTotal),
  );

  return lines.join("\n");
}
