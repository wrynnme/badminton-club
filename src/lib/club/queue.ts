import type { ClubQueueSettings } from "./queue-settings";

/**
 * Pure rotation-queue logic for club sessions. No DB / no side effects so it is
 * fully unit-testable (mirrors tournament scoring.ts / scheduling.ts pattern).
 *
 * Picks the next match from the pool of available players according to
 * queue_mode + rotation_mode, then splits the chosen players into two balanced
 * sides. winner_stays is handled by the caller passing `stayingSide`; the
 * winner_stays_max cap is enforced in the action layer (it needs the streak),
 * not here.
 */

export type QueuePlayer = {
  id: string;
  /** drag-sort order; null sorts after numbered rows */
  position: number | null;
  /** ISO timestamp — FIFO tiebreak */
  joined_at: string;
  /** numeric skill level; null = unknown (treated as 0 for balancing) */
  level: number | null;
  games_played: number;
  /** ISO timestamp a player last finished a game; null = never played (= longest rest) */
  last_finished_at: string | null;
};

export type MatchSide = { player1: string; player2: string | null };
export type ProposedMatch = { sideA: MatchSide; sideB: MatchSide };

const lvl = (p: QueuePlayer): number => p.level ?? 0;
const ts = (s: string | null): number => (s == null ? -Infinity : Date.parse(s));

/** Stable final tiebreak so ordering is deterministic (testable). */
function byId(a: QueuePlayer, b: QueuePlayer): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** FIFO: position asc (nulls last), then joined_at asc. */
function cmpFifo(a: QueuePlayer, b: QueuePlayer): number {
  const pa = a.position ?? Number.POSITIVE_INFINITY;
  const pb = b.position ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  const ja = Date.parse(a.joined_at);
  const jb = Date.parse(b.joined_at);
  if (ja !== jb) return ja - jb;
  return byId(a, b);
}

/** Longest rest first: last_finished_at asc (null = never played = front), then fewer games, then FIFO. */
function cmpRestLongest(a: QueuePlayer, b: QueuePlayer): number {
  const ta = ts(a.last_finished_at);
  const tb = ts(b.last_finished_at);
  if (ta !== tb) return ta - tb;
  if (a.games_played !== b.games_played) return a.games_played - b.games_played;
  return cmpFifo(a, b);
}

/**
 * Order the pool to decide WHO plays next (not the side split).
 * level_match is handled separately (anchor + nearest-level), so this covers
 * fifo / rest_longest / smart (smart v1 = rest_longest; level only affects the split).
 */
export function orderPool(pool: QueuePlayer[], settings: ClubQueueSettings): QueuePlayer[] {
  const copy = [...pool];
  if (settings.queue_mode === "fifo") {
    copy.sort(cmpFifo);
  } else {
    // rest_longest + smart(v1)
    copy.sort(cmpRestLongest);
  }
  return copy;
}

/**
 * balanced match: anchor = คนพักนานสุด, เลือกที่เหลือ nearest-to-anchor (rest เป็น
 * tiebreak). เมื่อ max_skill_gap > 0 และ anchor มีระดับ → กรอง candidate ที่ห่างเกิน
 * เพดานออก; ผู้เล่นที่ level===null ผ่านเสมอ (ยังไม่จัดระดับ).
 *
 * - max_skill_gap===0 หรือ anchor ยังไม่จัดระดับ → nearest-to-anchor ล้วน
 * - strict + ไม่พอคน  → คืน null (caller คืน null ต่อ = ไม่มีแมตช์)
 * - loose/balanced + ไม่พอคน → ผ่อนเพดาน เลือก nearest จาก candidate ทั้งหมด
 */
function pickBalancedMatch(
  pool: QueuePlayer[],
  need: number,
  settings: ClubQueueSettings,
): QueuePlayer[] | null {
  const rested = [...pool].sort(cmpRestLongest);
  const anchor = rested[0];
  const candidates = rested.slice(1);

  // Sort comparator: nearest level to anchor first, rest_longest as tiebreak
  const byNearest = (a: QueuePlayer, b: QueuePlayer) => {
    const da = Math.abs(lvl(a) - lvl(anchor));
    const db = Math.abs(lvl(b) - lvl(anchor));
    if (da !== db) return da - db;
    return cmpRestLongest(a, b);
  };

  const gap = settings.max_skill_gap;

  if (gap > 0 && anchor.level != null) {
    // null-level players are always eligible (ยังไม่จัดระดับ — ห้ามกรองออก)
    const eligible = candidates.filter(
      (c) => c.level == null || Math.abs(lvl(c) - lvl(anchor)) <= gap,
    );

    if (eligible.length >= need - 1) {
      // พอคน: เลือก nearest จาก eligible เท่านั้น
      const sorted = [...eligible].sort(byNearest);
      return [anchor, ...sorted.slice(0, need - 1)];
    }

    // ไม่พอคน: ตัดสินใจตาม strictness
    if (settings.balance_strictness === "strict") {
      return null; // ปฏิเสธแมตช์
    }
    // loose / balanced: ผ่อนเพดาน — ใช้ candidate ทั้งหมด
  }

  // max_skill_gap===0 / anchor ยังไม่จัดระดับ / fallthrough: nearest-to-anchor จาก candidate ทั้งหมด
  const sorted = [...candidates].sort(byNearest);
  return [anchor, ...sorted.slice(0, need - 1)];
}

/**
 * Split `chosen` (length = 2*players_per_team) into two sides.
 * skill_level_enabled → balance total level (greedy: strongest first to lower-sum side).
 * Otherwise → split in the given order (first half = sideA).
 *
 * ppt===2 + equal sums after greedy → intra-side gap tiebreak: enumerate all 3
 * possible pairings of the 4 sorted players, keep equal-sum ones, pick the
 * partition with the smallest max(|partner_gap_A|, |partner_gap_B|). This avoids
 * a [9,1] vs [5,5] split when a [6,4] vs [5,5] split achieves the same sum balance.
 */
function splitSides(chosen: QueuePlayer[], settings: ClubQueueSettings): ProposedMatch {
  const ppt = settings.players_per_team;
  let a: QueuePlayer[];
  let b: QueuePlayer[];

  if (settings.skill_level_enabled) {
    const sorted = [...chosen].sort((x, y) => lvl(y) - lvl(x) || byId(x, y)); // level desc
    a = [];
    b = [];
    // Greedy: assign each (strongest first) to whichever side has the lower total
    // and still has room. Produces balanced totals for both singles and doubles.
    let sumA = 0;
    let sumB = 0;
    for (const p of sorted) {
      const canA = a.length < ppt;
      const canB = b.length < ppt;
      if (canA && (!canB || sumA <= sumB)) {
        a.push(p);
        sumA += lvl(p);
      } else {
        b.push(p);
        sumB += lvl(p);
      }
    }

    // Intra-side gap tiebreak — only for doubles when sums are already equal.
    // Greedy with 4 players [p0,p1,p2,p3] sorted desc always yields partition P3:
    // (p0,p3) vs (p1,p2). Check all 3 pairings for equal sums + lower max intra-gap.
    if (ppt === 2 && sumA === sumB) {
      const [p0, p1, p2, p3] = sorted;
      // Three candidate partitions (each as [sideA, sideB]):
      const partitions: [QueuePlayer[], QueuePlayer[]][] = [
        [[p0, p1], [p2, p3]], // P1
        [[p0, p2], [p1, p3]], // P2
        [[p0, p3], [p1, p2]], // P3 — greedy result
      ];
      const intraSideGap = (s: QueuePlayer[]) => Math.abs(lvl(s[0]) - lvl(s[1]));
      const maxGap = (pa: QueuePlayer[], pb: QueuePlayer[]) =>
        Math.max(intraSideGap(pa), intraSideGap(pb));

      let bestA = a;
      let bestB = b;
      let bestGap = maxGap(a, b);

      for (const [pa, pb] of partitions) {
        const sa = lvl(pa[0]) + lvl(pa[1]);
        const sb = lvl(pb[0]) + lvl(pb[1]);
        if (sa !== sb) continue; // skip unbalanced partitions
        const g = maxGap(pa, pb);
        if (g < bestGap) {
          bestGap = g;
          bestA = pa;
          bestB = pb;
        }
      }
      a = bestA;
      b = bestB;
    }
  } else {
    a = chosen.slice(0, ppt);
    b = chosen.slice(ppt, ppt * 2);
  }

  return {
    sideA: { player1: a[0].id, player2: ppt === 2 ? a[1].id : null },
    sideB: { player1: b[0].id, player2: ppt === 2 ? b[1].id : null },
  };
}

/** A locked pair: two club_players who must be teammates (same side). */
export type LockedPair = readonly [string, string];

/**
 * Greedily form `sidesNeeded` complete sides from `ordered` (already in
 * fairness order), honouring locked pairs: a locked pair always fills ONE side
 * together, free players are buffered in twos (doubles) / ones (singles).
 * Returns null if not enough units to fill the requested sides.
 *
 * Strict-lock precondition: the caller must already have removed any locked
 * player whose partner is absent, so every locked player reached here has its
 * partner present somewhere in `ordered`.
 */
function takeSides(
  ordered: QueuePlayer[],
  partnerOf: Map<string, string>,
  sidesNeeded: number,
  ppt: number,
): MatchSide[] | null {
  const used = new Set<string>();
  const sides: MatchSide[] = [];
  let freeBuf: QueuePlayer[] = [];

  for (const p of ordered) {
    if (sides.length >= sidesNeeded) break;
    if (used.has(p.id)) continue;

    const partner = partnerOf.get(p.id);
    if (partner != null && ppt === 2) {
      // Locked pair fills a whole side. Its partner has not been used yet:
      // a player belongs to at most one lock, so if the partner had appeared
      // earlier the pair would already have formed and `p` would be `used`.
      sides.push({ player1: p.id, player2: partner });
      used.add(p.id);
      used.add(partner);
    } else {
      freeBuf.push(p);
      used.add(p.id);
      if (freeBuf.length === ppt) {
        sides.push({
          player1: freeBuf[0].id,
          player2: ppt === 2 ? freeBuf[1].id : null,
        });
        freeBuf = [];
      }
    }
  }

  return sides.length >= sidesNeeded ? sides.slice(0, sidesNeeded) : null;
}

/**
 * Build the next match from `pool` (players available = checked-in & not currently
 * playing). Returns null if there are not enough players.
 *
 * @param stayingSide  winner_stays only: the side already on court that keeps playing.
 *                     When provided, sideA = stayingSide and only the opponents are
 *                     drawn from the pool. The caller decides whether to pass this
 *                     (enforcing winner_stays_max via the streak it tracks).
 * @param lockedPairs  doubles-only: pairs that must be teammates. Strict — a locked
 *                     player whose partner is not in the pool waits (is dropped from
 *                     selection) rather than playing with someone else. When any lock
 *                     is active in a match, skill-balanced splitting is skipped (the
 *                     locked pairing is fixed; opponents are taken in fairness order).
 */
export function buildNextMatch(
  pool: QueuePlayer[],
  settings: ClubQueueSettings,
  stayingSide?: MatchSide,
  lockedPairs: LockedPair[] = [],
): ProposedMatch | null {
  const ppt = settings.players_per_team;
  const hasLocks = ppt === 2 && lockedPairs.length > 0;
  // skill matchmaking applies to level_match / smart when enabled
  const useBalanced =
    settings.skill_level_enabled &&
    (settings.queue_mode === "level_match" || settings.queue_mode === "smart");

  if (hasLocks) {
    const partnerOf = new Map<string, string>();
    for (const [a, b] of lockedPairs) {
      partnerOf.set(a, b);
      partnerOf.set(b, a);
    }
    const poolIds = new Set(pool.map((p) => p.id));
    // Strict: drop locked players whose partner is absent — they wait.
    let selectable = pool.filter((p) => {
      const partner = partnerOf.get(p.id);
      return partner == null || poolIds.has(partner);
    });

    if (settings.rotation_mode === "winner_stays" && stayingSide) {
      const stay = new Set(
        [stayingSide.player1, stayingSide.player2].filter((x): x is string => x != null),
      );
      selectable = selectable.filter((p) => !stay.has(p.id));
      const opp = takeSides(orderPool(selectable, settings), partnerOf, 1, ppt);
      if (!opp) return null;
      return { sideA: stayingSide, sideB: opp[0] };
    }

    const sides = takeSides(orderPool(selectable, settings), partnerOf, 2, ppt);
    if (!sides) return null;

    // balance_locked_pairs: ตรวจ gap ระหว่าง mean level ของ 2 ฝั่ง
    if (settings.balance_locked_pairs && settings.max_skill_gap > 0 && settings.balance_strictness === "strict") {
      const meanLevel = (side: MatchSide) => {
        const ids = [side.player1, side.player2].filter((x): x is string => x != null);
        const levels = ids.map((id) => pool.find((p) => p.id === id)).map((p) => lvl(p!));
        return levels.reduce((s, v) => s + v, 0) / (levels.length || 1);
      };
      if (Math.abs(meanLevel(sides[0]) - meanLevel(sides[1])) > settings.max_skill_gap) {
        return null;
      }
    }

    return { sideA: sides[0], sideB: sides[1] };
  }

  if (settings.rotation_mode === "winner_stays" && stayingSide) {
    if (pool.length < ppt) return null;
    if (useBalanced) {
      const picked = pickBalancedMatch(pool, ppt, settings);
      if (!picked) return null;
      return {
        sideA: stayingSide,
        sideB: { player1: picked[0].id, player2: ppt === 2 ? picked[1].id : null },
      };
    }
    const ordered = orderPool(pool, settings).slice(0, ppt);
    return {
      sideA: stayingSide,
      sideB: { player1: ordered[0].id, player2: ppt === 2 ? ordered[1].id : null },
    };
  }

  const need = ppt * 2;
  if (pool.length < need) return null;

  if (useBalanced) {
    const chosen = pickBalancedMatch(pool, need, settings);
    if (!chosen) return null;
    return splitSides(chosen, settings);
  }

  const chosen = orderPool(pool, settings).slice(0, need);
  return splitSides(chosen, settings);
}

/** The 4 side columns of a match (null = empty slot). */
export type PartialSlots = {
  a1: string | null;
  a2: string | null;
  b1: string | null;
  b2: string | null;
};

/**
 * Fallback when the pool is too small for a FULL match: place the available players (in
 * queue order) into the slots as a PARTIAL match — the organizer reserves the court now,
 * fills the remaining slot(s) later (inline edit), and can't START until the roster is full
 * (isClubMatchFull). Fill sideA then sideB in order; winner_stays keeps the staying side on
 * sideA and draws opponents into sideB. Empty slots are null. Returns null only when there's
 * nothing to place (empty pool).
 */
export function buildPartialMatch(
  pool: QueuePlayer[],
  settings: ClubQueueSettings,
  stayingSide?: MatchSide,
): PartialSlots | null {
  const ppt = settings.players_per_team;
  const ordered = orderPool(pool, settings);
  if (ordered.length === 0) return null;
  if (settings.rotation_mode === "winner_stays" && stayingSide) {
    return {
      a1: stayingSide.player1,
      a2: stayingSide.player2,
      b1: ordered[0]?.id ?? null,
      b2: ppt === 2 ? (ordered[1]?.id ?? null) : null,
    };
  }
  return {
    a1: ordered[0]?.id ?? null,
    a2: ppt === 2 ? (ordered[1]?.id ?? null) : null,
    b1: (ppt === 2 ? ordered[2]?.id : ordered[1]?.id) ?? null,
    b2: ppt === 2 ? (ordered[3]?.id ?? null) : null,
  };
}

/**
 * A match is "full" (ready to start) when every required player slot is filled.
 * Partial-roster matches (an organizer reserves a court with as few as 1 player)
 * leave slots null until edited — they may sit in the pending queue but cannot be
 * STARTED. doubles (ppt=2) need all four slots; singles (ppt=1) need both player1
 * slots (the player2 slots are always null for singles).
 *
 * Pure + shared: startClubMatchAction guards on it server-side, and the queue panel
 * disables the "เริ่ม" button with it client-side, so the two never disagree.
 */
export function isClubMatchFull(
  m: {
    side_a_player1: string | null;
    side_a_player2: string | null;
    side_b_player1: string | null;
    side_b_player2: string | null;
  },
  playersPerTeam: number,
): boolean {
  if (m.side_a_player1 == null || m.side_b_player1 == null) return false;
  if (playersPerTeam === 2) {
    return m.side_a_player2 != null && m.side_b_player2 != null;
  }
  return true;
}

/**
 * Derive the winning side from a finished game's score.
 * Returns "a" / "b" for the higher score, or null on a tie (a recorded full
 * score should normally have a winner — callers may reject the tie at input).
 */
export function deriveWinnerSide(
  scoreA: number,
  scoreB: number,
): "a" | "b" | null {
  if (scoreA > scoreB) return "a";
  if (scoreB > scoreA) return "b";
  return null;
}
