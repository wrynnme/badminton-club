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
function orderPool(pool: QueuePlayer[], settings: ClubQueueSettings): QueuePlayer[] {
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
 * level_match: anchor = longest-rested player, then fill with the players whose
 * level is closest to the anchor (rest as tiebreak). Keeps fairness (anchor is
 * most-rested) while grouping similar levels into one match.
 */
function pickLevelMatch(pool: QueuePlayer[], need: number): QueuePlayer[] {
  const rested = [...pool].sort(cmpRestLongest);
  const anchor = rested[0];
  const rest = rested.slice(1).sort((a, b) => {
    const da = Math.abs(lvl(a) - lvl(anchor));
    const db = Math.abs(lvl(b) - lvl(anchor));
    if (da !== db) return da - db;
    return cmpRestLongest(a, b);
  });
  return [anchor, ...rest.slice(0, need - 1)];
}

/**
 * Split `chosen` (length = 2*players_per_team) into two sides.
 * skill_level_enabled → balance total level (snake: strongest + weakest vs middle).
 * Otherwise → split in the given order (first half = sideA).
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
  } else {
    a = chosen.slice(0, ppt);
    b = chosen.slice(ppt, ppt * 2);
  }

  return {
    sideA: { player1: a[0].id, player2: ppt === 2 ? a[1].id : null },
    sideB: { player1: b[0].id, player2: ppt === 2 ? b[1].id : null },
  };
}

/**
 * Build the next match from `pool` (players available = checked-in & not currently
 * playing). Returns null if there are not enough players.
 *
 * @param stayingSide  winner_stays only: the side already on court that keeps playing.
 *                     When provided, sideA = stayingSide and only the opponents are
 *                     drawn from the pool. The caller decides whether to pass this
 *                     (enforcing winner_stays_max via the streak it tracks).
 */
export function buildNextMatch(
  pool: QueuePlayer[],
  settings: ClubQueueSettings,
  stayingSide?: MatchSide,
): ProposedMatch | null {
  const ppt = settings.players_per_team;

  if (settings.rotation_mode === "winner_stays" && stayingSide) {
    if (pool.length < ppt) return null;
    const ordered =
      settings.queue_mode === "level_match"
        ? pickLevelMatch(pool, ppt)
        : orderPool(pool, settings).slice(0, ppt);
    return {
      sideA: stayingSide,
      sideB: { player1: ordered[0].id, player2: ppt === 2 ? ordered[1].id : null },
    };
  }

  const need = ppt * 2;
  if (pool.length < need) return null;

  const chosen =
    settings.queue_mode === "level_match"
      ? pickLevelMatch(pool, need)
      : orderPool(pool, settings).slice(0, need);

  return splitSides(chosen, settings);
}
