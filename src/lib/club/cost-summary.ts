// Club cost summary — DB-adapter layer over the pure cost-split math.
//
// Builds the `SplitInput` from live DB rows (club + club_players + club_matches)
// and rolls the per-player court / shuttle / expense / discount shares into one
// session grand total. This is the SINGLE source of the "ค่าใช้จ่ายรวม" number:
// both the cost-breakdown table and the dashboard card consume it, so the two
// tabs cannot drift (gapPolicy=ignore under-collect, shuttle=per_player
// over-collect, and per-player discounts are all reflected identically).

import {
  clampedSessionMinutes,
  computeClubSplit,
  computeExpenseShares,
  hourlySlotPresence,
  sessionHourSlots,
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
  | "shuttle_hourly"
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
    shuttleHourly: club.shuttle_hourly,
    matches: splitMatches,
    sessionStart: club.start_time,
    sessionEnd: club.end_time,
    gapPolicy: club.court_gap_policy,
    ownerId: ownerPlayerId,
  };
}

/**
 * One player's session total: court + shuttle + personal-expense share − discount,
 * floored at 0 (a discount can't make a player owe negative). The single definition
 * of the per-player total — shared by the summary roll-up and the breakdown table so
 * the grand total reconciles by construction.
 */
export function playerSessionTotal(parts: {
  court: number;
  shuttle: number;
  expense: number;
  discount: number;
}): number {
  return Math.max(0, parts.court + parts.shuttle + parts.expense - parts.discount);
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
    grandTotal += playerSessionTotal({ court: row.court, shuttle: row.shuttle, expense: exp, discount: disc });
  }

  const totalCourt = rows.reduce((s, r) => s + r.court, 0);
  const totalShuttle = rows.reduce((s, r) => s + r.shuttle, 0);
  const totalExp = [...expShareById.values()].reduce((s, v) => s + v, 0);
  // Cap each player's discount at their pre-discount subtotal so the footer reconciles:
  // grandTotal floors each player at max(0, …), so a discount larger than a player's
  // subtotal must not be counted beyond what was actually applied.
  // → totalCourt + totalShuttle + totalExp − totalDiscount === grandTotal.
  const totalDiscount = rows.reduce((s, r) => {
    const exp = expShareById.get(r.playerId) ?? 0;
    const disc = discountById.get(r.playerId) ?? 0;
    return s + Math.min(disc, r.court + r.shuttle + exp);
  }, 0);

  return { rows, expShareById, totalCourt, totalShuttle, totalExp, totalDiscount, grandTotal };
}

function fmtHHMM(min: number): string {
  const v = ((min % 1440) + 1440) % 1440; // wrap cross-midnight back to clock time
  const h = Math.floor(v / 60);
  const m = v % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** One 1-hour session slot for the by_time shuttle input: an "HH:MM–HH:MM" label and
 *  how many players cover the FULL slot. Presence comes from `hourlySlotPresence` —
 *  the SAME source computeShuttle's by_time split divides among — so the headcount
 *  shown next to each hour equals the number of payers. Slot order matches
 *  club.shuttle_hourly indices. */
export type HourlyShuttleSlot = { label: string; count: number };

export function buildHourlyShuttleSlots(
  club: Pick<Club, "start_time" | "end_time">,
  players: Pick<ClubPlayer, "start_time" | "end_time">[],
): HourlyShuttleSlot[] {
  const { slots } = hourlySlotPresence(
    club.start_time,
    club.end_time,
    players.map((p, i) => ({
      id: String(i),
      start: p.start_time ?? club.start_time,
      end: p.end_time ?? club.end_time,
    })),
  );
  return slots.map((s) => ({
    label: `${fmtHHMM(s.start)}–${fmtHHMM(s.end)}`,
    count: s.presentIds.length,
  }));
}

/** Format decimal hours for display: 3.0 → "3", 2.5 → "2.5", 1.333… → "1.3". */
export function formatHours(h: number): string {
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Per-player session usage: presence hours + shuttles consumed in matches joined. */
export type PlayerUsage = { hours: number; shuttles: number };

/**
 * Per-player presence hours + shuttles used. `hours` is decimal hours (minutes ÷ 60).
 * Shuttle count credits the FULL count to every participant — a usage count, NOT a
 * fair share (the per-player shuttle COST is the ค่าลูก column). Source matches the
 * cost basis so the usage column lines up with the cost column:
 *  - by_time → each present player credited the slot's hourly count (via
 *    hourlySlotPresence — the SAME presence the by_time cost split uses);
 *  - else → summed over the in_progress+completed matches the player joined.
 */
export function computePlayerUsage(input: {
  club: Pick<Club, "start_time" | "end_time" | "shuttle_split" | "shuttle_hourly">;
  players: Pick<ClubPlayer, "id" | "start_time" | "end_time">[];
  matches: Pick<
    ClubMatch,
    "status" | "side_a_player1" | "side_a_player2" | "side_b_player1" | "side_b_player2" | "shuttles_used"
  >[];
}): Map<string, PlayerUsage> {
  const usage = new Map<string, PlayerUsage>();
  for (const p of input.players) {
    const mins = clampedSessionMinutes(
      p.start_time ?? input.club.start_time,
      p.end_time ?? input.club.end_time,
      input.club.start_time,
      input.club.end_time,
    );
    usage.set(p.id, { hours: mins / 60, shuttles: 0 });
  }

  if (input.club.shuttle_split === "by_time") {
    const hourly = input.club.shuttle_hourly ?? [];
    const { slots } = hourlySlotPresence(
      input.club.start_time,
      input.club.end_time,
      input.players.map((p) => ({
        id: p.id,
        start: p.start_time ?? input.club.start_time,
        end: p.end_time ?? input.club.end_time,
      })),
    );
    slots.forEach((s, i) => {
      const count = Math.max(0, hourly[i] ?? 0);
      if (count <= 0) return;
      for (const id of s.presentIds) {
        const u = usage.get(id);
        if (u) u.shuttles += count;
      }
    });
    return usage;
  }

  for (const m of input.matches) {
    if (m.status !== "in_progress" && m.status !== "completed") continue;
    const ids = [m.side_a_player1, m.side_a_player2, m.side_b_player1, m.side_b_player2].filter(
      (id): id is string => Boolean(id),
    );
    for (const id of ids) {
      const u = usage.get(id);
      if (u) u.shuttles += m.shuttles_used;
    }
  }
  return usage;
}

/** One fully-assembled per-player cost+usage display row (the shape every cost
 * surface — cost table, dashboard table, CSV — renders). `shuttle` is the shuttle
 * COST; `shuttles` is the physical count. */
export type ClubCostRow = {
  playerId: string;
  hours: number;
  games: number;
  shuttles: number;
  court: number;
  shuttle: number;
  expense: number;
  discount: number;
  total: number;
};

/**
 * The single builder of the per-player cost+usage rows. Folds the court/shuttle
 * split, personal-expense share, discount and usage (hours/shuttles) into one row
 * each (+ session totals) so the cost table, dashboard table and CSV all render
 * from ONE source and can't drift. Costs round per `computeClubSplit` (ceil).
 */
export function computeClubCostRows(input: {
  club: ClubCostFields;
  players: Pick<
    ClubPlayer,
    "id" | "profile_id" | "start_time" | "end_time" | "games_played" | "discount"
  >[];
  matches: Parameters<typeof buildClubSplitInput>[2];
  expenses: CostExpenseInput[];
}): {
  rows: ClubCostRow[];
  totalCourt: number;
  totalShuttle: number;
  totalExp: number;
  totalDiscount: number;
  grandTotal: number;
  /** Physical total shuttles consumed, once each (NOT the per-player `shuttles`
   * column, which full-credits every participant and over-counts). by_time →
   * Σ shuttle_hourly over the real session slots; else → Σ shuttles_used over
   * in_progress+completed matches. */
  totalShuttlesUsed: number;
} {
  const summary = computeClubCostSummary(input);
  const usage = computePlayerUsage(input);
  const discountById = new Map(input.players.map((p) => [p.id, p.discount ?? 0]));
  const gamesById = new Map(input.players.map((p) => [p.id, p.games_played ?? 0]));

  const rows: ClubCostRow[] = summary.rows.map((r) => {
    const u = usage.get(r.playerId) ?? { hours: 0, shuttles: 0 };
    const expense = summary.expShareById.get(r.playerId) ?? 0;
    const discount = discountById.get(r.playerId) ?? 0;
    return {
      playerId: r.playerId,
      hours: u.hours,
      games: gamesById.get(r.playerId) ?? 0,
      shuttles: u.shuttles,
      court: r.court,
      shuttle: r.shuttle,
      expense,
      discount,
      total: playerSessionTotal({ court: r.court, shuttle: r.shuttle, expense, discount }),
    };
  });

  const totalShuttlesUsed =
    input.club.shuttle_split === "by_time"
      ? sessionHourSlots(input.club.start_time, input.club.end_time).reduce(
          (s, _slot, i) => s + Math.max(0, input.club.shuttle_hourly?.[i] ?? 0),
          0,
        )
      : input.matches
          .filter((m) => m.status === "in_progress" || m.status === "completed")
          .reduce((s, m) => s + m.shuttles_used, 0);

  return {
    rows,
    totalCourt: summary.totalCourt,
    totalShuttle: summary.totalShuttle,
    totalExp: summary.totalExp,
    totalDiscount: summary.totalDiscount,
    grandTotal: summary.grandTotal,
    totalShuttlesUsed,
  };
}
