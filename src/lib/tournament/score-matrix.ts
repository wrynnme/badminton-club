import type { Match } from "@/lib/types";
import { sumGameScores, gameWinner } from "@/lib/tournament/scoring";

export type CellResult =
  | {
      state: "score";
      rowGames: number;
      colGames: number;
      rowPoints: number;
      colPoints: number;
      result: "W" | "L" | "D";
    }
  | { state: "scheduled" }
  | { state: "none" };

/**
 * Build an N×N score matrix from a set of matches.
 *
 * - All statuses are accepted (to distinguish `scheduled` from `none`).
 * - Matches are processed sorted by `match_number` ASC so the highest
 *   match_number wins on duplicate fixture (deterministic last-write).
 * - BYE walkovers (completed but games.length === 0) are treated as
 *   `scheduled` (never downgrade an existing `score` cell).
 * - Diagonal entries (rowId === colId) are NOT stored — the component
 *   renders `—` based on index comparison.
 *
 * Returns `Map<rowId, Map<colId, CellResult>>`.
 */
export function buildScoreMatrix(
  matches: Match[],
  competitorIds: string[],
  unit: "team" | "pair",
): Map<string, Map<string, CellResult>> {
  const idSet = new Set(competitorIds);

  // Initialize grid: all off-diagonal pairs → "none"
  const grid = new Map<string, Map<string, CellResult>>();
  for (const rowId of competitorIds) {
    const row = new Map<string, CellResult>();
    for (const colId of competitorIds) {
      if (rowId !== colId) {
        row.set(colId, { state: "none" });
      }
    }
    grid.set(rowId, row);
  }

  // Process matches in match_number ASC order for deterministic last-write
  const sorted = [...matches].sort((a, b) => a.match_number - b.match_number);

  for (const m of sorted) {
    const aId = unit === "team" ? m.team_a_id : m.pair_a_id;
    const bId = unit === "team" ? m.team_b_id : m.pair_b_id;

    // Skip if either side is missing or not in competitorIds
    if (!aId || !bId) continue;
    if (!idSet.has(aId) || !idSet.has(bId)) continue;

    const isCompletedWithGames =
      m.status === "completed" && m.games.length > 0;

    if (isCompletedWithGames) {
      // Compute score cell from side A's perspective.
      // Games-won counted from m.games directly (single source of truth) —
      // not the denormalized team_a_score/team_b_score, so games/result/points
      // can never disagree if the denormalized counts drift.
      let gamesA = 0;
      let gamesB = 0;
      for (const g of m.games) {
        if (g.a > g.b) gamesA++;
        else if (g.b > g.a) gamesB++;
      }
      const tot = sumGameScores(m.games);
      const win = gameWinner(m.games);

      const resultA: "W" | "L" | "D" =
        win === "a" ? "W" : win === "b" ? "L" : "D";
      const resultB: "W" | "L" | "D" =
        win === "b" ? "W" : win === "a" ? "L" : "D";

      // Always overwrite (last-write wins per match_number sort)
      grid.get(aId)?.set(bId, {
        state: "score",
        rowGames: gamesA,
        colGames: gamesB,
        rowPoints: tot.a,
        colPoints: tot.b,
        result: resultA,
      });
      grid.get(bId)?.set(aId, {
        state: "score",
        rowGames: gamesB,
        colGames: gamesA,
        rowPoints: tot.b,
        colPoints: tot.a,
        result: resultB,
      });
    } else {
      // Pending / in_progress / BYE (completed, games empty):
      // Only set "scheduled" if the current cell is still "none"
      const abCurrent = grid.get(aId)?.get(bId);
      if (abCurrent?.state === "none") {
        grid.get(aId)?.set(bId, { state: "scheduled" });
      }
      const baCurrent = grid.get(bId)?.get(aId);
      if (baCurrent?.state === "none") {
        grid.get(bId)?.set(aId, { state: "scheduled" });
      }
    }
  }

  return grid;
}
