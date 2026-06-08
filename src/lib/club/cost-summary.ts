// Club cost summary — DB-adapter layer over the pure cost-split math.
//
// Builds the `SplitInput` from live DB rows (club + club_players + club_matches)
// and rolls the per-player court / shuttle / expense / discount shares into one
// session grand total. This is the SINGLE source of the "ค่าใช้จ่ายรวม" number:
// both the cost-breakdown table and the dashboard card consume it, so the two
// tabs cannot drift (gapPolicy=ignore under-collect, shuttle=per_player
// over-collect, and per-player discounts are all reflected identically).

import {
  computeClubSplit,
  computeExpenseShares,
  type SplitInput,
  type SplitRow,
} from "@/lib/club/cost-split";
import type { Club, ClubPlayer, ClubMatch } from "@/lib/types";

/** Minimal expense shape (matches `club_expenses` rows; amount may arrive as text). */
export type CostExpenseInput = {
  amount: number | string;
  payer_player_ids: string[];
};

type ClubCostFields = Pick<
  Club,
  | "owner_id"
  | "court_fee"
  | "court_split"
  | "shuttle_split"
  | "shuttle_price"
  | "start_time"
  | "end_time"
  | "court_gap_policy"
>;

/**
 * Assemble the `SplitInput` for `computeClubSplit` from DB rows. Shared by the
 * cost-breakdown table and the dashboard so the court/shuttle math is derived
 * in exactly one place. Only in_progress + completed matches consume shuttles.
 */
export function buildClubSplitInput(
  club: ClubCostFields,
  players: Pick<ClubPlayer, "id" | "profile_id" | "start_time" | "end_time" | "games_played">[],
  matches: Pick<ClubMatch, "status" | "side_a_player1" | "side_a_player2" | "side_b_player1" | "side_b_player2" | "shuttles_used">[],
): SplitInput {
  // computeClubSplit keys by club_players.id, but club.owner_id is a profile_id.
  const ownerPlayerId = players.find((p) => p.profile_id === club.owner_id)?.id;

  const splitMatches = matches
    .filter((m) => m.status === "in_progress" || m.status === "completed")
    .map((m) => ({
      playerIds: [
        m.side_a_player1,
        m.side_a_player2,
        m.side_b_player1,
        m.side_b_player2,
      ].filter((id): id is string => Boolean(id)),
      shuttles: m.shuttles_used,
    }));

  return {
    players: players.map((p) => ({
      id: p.id,
      start: p.start_time ?? club.start_time,
      end: p.end_time ?? club.end_time,
      games: p.games_played,
    })),
    courtFee: club.court_fee,
    courtSplit: club.court_split,
    shuttleSplit: club.shuttle_split,
    shuttlePrice: club.shuttle_price,
    matches: splitMatches,
    sessionStart: club.start_time,
    sessionEnd: club.end_time,
    gapPolicy: club.court_gap_policy,
    ownerId: ownerPlayerId,
  };
}

export type ClubCostSummary = {
  rows: SplitRow[];
  /** Per-player personal-expense share (club_players.id → baht). */
  expShareById: Map<string, number>;
  totalCourt: number;
  totalShuttle: number;
  totalExp: number;
  totalDiscount: number;
  /** Σ max(0, court + shuttle + expense − discount) over all players. */
  grandTotal: number;
};

/**
 * Roll the per-player split + personal expenses − discounts into session totals.
 * Discounts come from `club_players.discount` (DB source of truth) — the live
 * editable cells in the cost table manage their own state, but on a fresh render
 * this grand total equals what that table shows.
 */
export function computeClubCostSummary(input: {
  club: ClubCostFields;
  players: Pick<ClubPlayer, "id" | "profile_id" | "start_time" | "end_time" | "games_played" | "discount">[];
  matches: Parameters<typeof buildClubSplitInput>[2];
  expenses: CostExpenseInput[];
}): ClubCostSummary {
  const { club, players, matches, expenses } = input;

  const rows = computeClubSplit(buildClubSplitInput(club, players, matches));

  const expShareById = computeExpenseShares(
    players.map((p) => p.id),
    expenses.map((e) => ({
      amount: Number(e.amount),
      payerPlayerIds: e.payer_player_ids,
    })),
  );

  const discountById = new Map<string, number>(
    players.map((p) => [p.id, p.discount ?? 0]),
  );

  let grandTotal = 0;
  for (const row of rows) {
    const exp = expShareById.get(row.playerId) ?? 0;
    const disc = discountById.get(row.playerId) ?? 0;
    grandTotal += Math.max(0, row.court + row.shuttle + exp - disc);
  }

  const totalCourt = rows.reduce((s, r) => s + r.court, 0);
  const totalShuttle = rows.reduce((s, r) => s + r.shuttle, 0);
  const totalExp = [...expShareById.values()].reduce((s, v) => s + v, 0);
  const totalDiscount = players.reduce((s, p) => s + (p.discount ?? 0), 0);

  return { rows, expShareById, totalCourt, totalShuttle, totalExp, totalDiscount, grandTotal };
}
