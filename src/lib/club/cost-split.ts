// Club cost split — pure, testable. Two independent buckets:
//   court_fee    → split "even" | "by_time" (per-segment fair share by presence)
//   shuttle (price × shuttles_used per match) → split "even" | "per_match" | "per_player"
// See spec.md "ระบบคิดเงินก๊วน (Club cost split)".

export type CourtSplit = "even" | "by_time";
export type ShuttleSplit = "even" | "per_match" | "per_player";
export type GapPolicy = "spread" | "owner" | "ignore";

export type SplitPlayer = {
  id: string;
  /** "HH:MM" or "HH:MM:SS" — clamped to the session window. */
  start: string;
  end: string;
  games: number;
};

/** One rotation-queue match's shuttle consumption (for shuttleSplit="per_match"). */
export type SplitMatch = {
  /** club_players ids on court for this match (2 singles / 4 doubles). */
  playerIds: string[];
  /** shuttles consumed by this match. */
  shuttles: number;
};

export type SplitInput = {
  players: SplitPlayer[];
  courtFee: number;
  courtSplit: CourtSplit;
  shuttleSplit: ShuttleSplit;
  sessionStart: string;
  sessionEnd: string;
  gapPolicy?: GapPolicy;
  /** Required only when gapPolicy === "owner". */
  ownerId?: string;
  /** Price per shuttle — used only when shuttleSplit="per_match". */
  shuttlePrice?: number;
  /** Matches played — used only when shuttleSplit="per_match". */
  matches?: SplitMatch[];
};

export type SplitRow = {
  playerId: string;
  court: number;
  shuttle: number;
  total: number;
};

/** "HH:MM" / "HH:MM:SS" → minutes since 00:00. */
function toMin(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Minutes a player is present within the (possibly cross-midnight) session window,
 * after clamping their window to it. Mirrors the by_time segmentation clamp so a
 * "hours played" display column lines up with the court split. Returns 0 for a
 * zero-length or inverted window.
 */
export function clampedSessionMinutes(
  start: string,
  end: string,
  sessionStart: string,
  sessionEnd: string,
): number {
  const s0 = toMin(sessionStart);
  let s1 = toMin(sessionEnd);
  const crossesMidnight = s1 < s0;
  if (crossesMidnight) s1 += 1440;
  if (s1 - s0 <= 0) return 0;
  const place = (t: string) => {
    const m = toMin(t);
    return crossesMidnight && m < s0 ? m + 1440 : m;
  };
  const ps = Math.max(place(start), s0);
  const pe = Math.min(place(end), s1);
  return Math.max(0, pe - ps);
}

/**
 * Round every player's exact per-player share UP to the next whole baht
 * (Math.ceil). Chosen over round-to-nearest + remainder-on-largest because that
 * dumped the whole leftover on one payer, so two players with the identical share
 * could differ by several baht (e.g. 104 vs 107). Ceil instead:
 *  - every player in the same share bucket lands on the identical whole number,
 *  - the collected sum is never short of the bill (it may OVER-collect by a few
 *    baht — accepted by design: the organizer is covered),
 *  - the column shows clean, equal figures.
 * A tiny epsilon absorbs floating-point dust so an exact integer share isn't
 * bumped up a baht; zero stays zero.
 */
function ceilBucket(exact: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, v] of exact) {
    out.set(id, Math.max(0, Math.ceil(v - 1e-9)));
  }
  return out;
}

function computeCourt(input: SplitInput): Map<string, number> {
  const { players, courtFee, courtSplit } = input;
  const out = new Map<string, number>(players.map((p) => [p.id, 0]));
  const n = players.length;
  if (n === 0 || courtFee <= 0) return out;

  if (courtSplit === "even") {
    const share = courtFee / n;
    for (const p of players) out.set(p.id, share);
    return out;
  }

  // by_time — segment the session by every player's clamped window boundary.
  const s0 = toMin(input.sessionStart);
  let s1 = toMin(input.sessionEnd);
  // Cross-midnight session (e.g. 21:00 → 01:00): the end is on the next day, so it
  // reads as a smaller minute-of-day than the start. Extend it by 24h so the window
  // is positive instead of negative (which previously hit the `sessionMin <= 0` guard
  // and silently dropped the ENTIRE court fee). `s1 === s0` is left as a zero-length
  // window (→ no court fee, unchanged) rather than treated as a full 24h.
  const crossesMidnight = s1 < s0;
  if (crossesMidnight) s1 += 1440;
  const sessionMin = s1 - s0;
  if (sessionMin <= 0) return out;

  // Place a "HH:MM" onto the (possibly midnight-spanning) session timeline: an
  // early-morning time (< the start-of-day minute) belongs to the next day, so it
  // gets the same +24h shift as the session end. No-op for non-crossing sessions.
  const place = (t: string) => {
    const m = toMin(t);
    return crossesMidnight && m < s0 ? m + 1440 : m;
  };

  // Per-player clamped window [ps, pe).
  const win = players.map((p) => {
    const ps = Math.max(place(p.start), s0);
    const pe = Math.min(place(p.end), s1);
    return { id: p.id, ps, pe };
  });

  const bounds = new Set<number>([s0, s1]);
  for (const w of win) {
    if (w.pe > w.ps) { bounds.add(w.ps); bounds.add(w.pe); }
  }
  const sorted = [...bounds].sort((a, b) => a - b);

  const gapPolicy = input.gapPolicy ?? "spread";
  for (let i = 0; i + 1 < sorted.length; i++) {
    const b1 = sorted[i];
    const b2 = sorted[i + 1];
    const segMin = b2 - b1;
    if (segMin <= 0) continue;
    const segCost = (courtFee * segMin) / sessionMin;
    const present = win.filter((w) => w.ps <= b1 && w.pe >= b2);

    if (present.length > 0) {
      const each = segCost / present.length;
      for (const w of present) out.set(w.id, (out.get(w.id) ?? 0) + each);
    } else {
      // Gap — nobody on court for this segment.
      if (gapPolicy === "ignore") continue;
      if (gapPolicy === "owner" && input.ownerId && out.has(input.ownerId)) {
        out.set(input.ownerId, (out.get(input.ownerId) ?? 0) + segCost);
      } else {
        // "spread" (and owner-fallback): share equally across all players.
        const each = segCost / n;
        for (const p of players) out.set(p.id, (out.get(p.id) ?? 0) + each);
      }
    }
  }
  return out;
}

function computeShuttle(input: SplitInput): Map<string, number> {
  const { players, shuttleSplit } = input;
  const out = new Map<string, number>(players.map((p) => [p.id, 0]));
  const n = players.length;
  if (n === 0) return out;

  // Shuttle cost is per-shuttle (shuttlePrice) and derived from each match's
  // shuttles_used. Both modes need a price + matches — without the rotation queue
  // (no matches recorded) shuttle cost is 0.
  const price = input.shuttlePrice ?? 0;
  if (price <= 0) return out;
  const matches = input.matches ?? [];

  if (shuttleSplit === "even") {
    // Σ shuttles across all matches × price, split EQUALLY among every player
    // (regardless of who played which match / how many games).
    const totalShuttles = matches.reduce((s, m) => s + Math.max(0, m.shuttles), 0);
    if (totalShuttles <= 0) return out;
    const share = (totalShuttles * price) / n;
    for (const p of players) out.set(p.id, share);
    return out;
  }

  // per_match — each match's (shuttles × price) split among that match's players.
  // per_player — each player in the match pays the FULL (shuttles × price), no division.
  // A removed player's share is dropped (under-collect, per_match only).
  for (const m of matches) {
    const k = m.playerIds.length;
    if (k === 0 || m.shuttles <= 0) continue;
    const cost = m.shuttles * price;
    const each = shuttleSplit === "per_player" ? cost : cost / k;
    for (const id of m.playerIds) {
      if (out.has(id)) out.set(id, (out.get(id) ?? 0) + each);
    }
  }
  return out;
}

/**
 * Split a club session's court + shuttle fees across its players. Returns one row
 * per player with whole-baht court / shuttle / total shares. Each share is rounded
 * UP to a whole baht (see `ceilBucket`), so a bucket may slightly OVER-collect by
 * design — equal players show equal figures and the bill is always covered. (Court
 * can still fall short of the full fee at the segment level when gapPolicy="ignore"
 * drops empty-court time — that's a deliberate non-charge, separate from rounding.)
 */
export function computeClubSplit(input: SplitInput): SplitRow[] {
  const court = ceilBucket(computeCourt(input));
  const shuttle = ceilBucket(computeShuttle(input));
  return input.players.map((p) => {
    const c = court.get(p.id) ?? 0;
    const s = shuttle.get(p.id) ?? 0;
    return { playerId: p.id, court: c, shuttle: s, total: c + s };
  });
}

/** One itemized club expense: empty payerPlayerIds = charged to ALL players. */
export type ExpenseShareInput = { amount: number; payerPlayerIds: string[] };

/**
 * Per-player personal-expense total ("ค่าใช้จ่ายส่วนบุคคล"). Each expense is split
 * ceil-per-head among its designated payers (or all players when none designated).
 * Mirrors the ExpenseManager rollup so the cost breakdown reconciles with it.
 */
export function computeExpenseShares(
  allPlayerIds: string[],
  expenses: ExpenseShareInput[],
): Map<string, number> {
  const out = new Map<string, number>(allPlayerIds.map((id) => [id, 0]));
  for (const e of expenses) {
    if (e.amount <= 0) continue;
    const designated = e.payerPlayerIds.length ? e.payerPlayerIds : allPlayerIds;
    const payers = designated.filter((id) => out.has(id));
    if (payers.length === 0) continue;
    const perHead = Math.ceil(e.amount / payers.length);
    for (const id of payers) out.set(id, (out.get(id) ?? 0) + perHead);
  }
  return out;
}
