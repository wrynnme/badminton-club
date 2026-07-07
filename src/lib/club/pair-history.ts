import type { MatchSide } from "./queue";

/**
 * Session pairing memory for "สุ่มคิว" variety. Counts, per unordered player
 * pair, how many times they were teammates (`partner`) or on opposite sides
 * (`opponent`) across the current session. The batch generator seeds this from
 * the matches already scheduled/played, then keeps it updated as it plans, so
 * it can spread partnerships and oppositions across the night instead of
 * pairing the same clusters again.
 *
 * Pure + no side effects (mirrors queue.ts) — lives in its own module so both
 * queue.ts (side-split tiebreak) and batch-queue.ts (grouping) can use it
 * without an import cycle (only `type` imports cross between them).
 */
export type PairHistory = {
  partner: Map<string, number>;
  opponent: Map<string, number>;
};

/** A side shaped loosely enough to accept DB rows (nullable player1). */
type SideLike = { player1: string | null; player2: string | null };

export function emptyPairHistory(): PairHistory {
  return { partner: new Map(), opponent: new Map() };
}

/** Independent clone so a mutating consumer never touches the caller's seed. */
export function clonePairHistory(h: PairHistory | undefined): PairHistory {
  return { partner: new Map(h?.partner), opponent: new Map(h?.opponent) };
}

/** Order-independent key for a player pair. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function bump(m: Map<string, number>, a: string, b: string): void {
  const k = pairKey(a, b);
  m.set(k, (m.get(k) ?? 0) + 1);
}

const idsOf = (s: SideLike): string[] =>
  [s.player1, s.player2].filter((x): x is string => x != null);

/** Fold one full match (two sides) into the history (mutates `hist`). */
export function recordPairing(hist: PairHistory, sideA: SideLike, sideB: SideLike): void {
  const A = idsOf(sideA);
  const B = idsOf(sideB);
  if (A.length === 2) bump(hist.partner, A[0], A[1]);
  if (B.length === 2) bump(hist.partner, B[0], B[1]);
  for (const a of A) for (const b of B) bump(hist.opponent, a, b);
}

/**
 * Fold ONE side's internal partnership only (mutates). Used for winner-chain
 * matches whose opponent is a not-yet-known promoted winner — the challenger
 * pair's partnership is real and countable, the opposition is not plannable.
 */
export function recordSidePartner(hist: PairHistory, side: MatchSide): void {
  const ids = idsOf(side);
  if (ids.length === 2) bump(hist.partner, ids[0], ids[1]);
}

/**
 * Repeat cost of a proposed full match: partner-repeats + opponent-repeats,
 * weighted equally. Lower = fresher matchup. 0 = nobody here has met before.
 */
export function pairingCost(hist: PairHistory, sideA: SideLike, sideB: SideLike): number {
  const A = idsOf(sideA);
  const B = idsOf(sideB);
  let cost = 0;
  if (A.length === 2) cost += hist.partner.get(pairKey(A[0], A[1])) ?? 0;
  if (B.length === 2) cost += hist.partner.get(pairKey(B[0], B[1])) ?? 0;
  for (const a of A) for (const b of B) cost += hist.opponent.get(pairKey(a, b)) ?? 0;
  return cost;
}

/** Partner-repeat cost of a single side (doubles); 0 for singles. */
export function partnerCost(hist: PairHistory, side: MatchSide): number {
  const ids = idsOf(side);
  return ids.length === 2 ? (hist.partner.get(pairKey(ids[0], ids[1])) ?? 0) : 0;
}

/** Times two specific players have been teammates this session. */
export function partnerPairCost(hist: PairHistory, a: string, b: string): number {
  return hist.partner.get(pairKey(a, b)) ?? 0;
}
