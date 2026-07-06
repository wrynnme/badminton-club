import type { ClubQueueSettings } from "./queue-settings";
import {
  buildNextMatch,
  orderPool,
  takeSides,
  keepsWinner,
  type QueuePlayer,
  type MatchSide,
  type LockedPair,
} from "./queue";
import { clampedSessionMinutes } from "./cost-split";

/**
 * Batch queue generation ("สุ่มคิว") — plans a whole set of courtless pending
 * matches so every player reaches their (pro-rated) minimum match count.
 *
 * Core trick: the generator SIMULATES the session on a cloned pool. After each
 * planned match the chosen players get games_played+1 and a synthetic, strictly
 * increasing last_finished_at — so every subsequent pick through the existing
 * queue helpers (buildNextMatch / orderPool / takeSides) automatically honours
 * rest spacing, FIFO order, level pairing, skill-gap strictness and locked
 * pairs without re-implementing any of those rules.
 */

export type BatchSide =
  | { kind: "players"; player1: string; player2: string | null }
  // Winner-of placeholder: resolved by finish_club_match promotion when the
  // source match (index into the returned plan array) completes with a winner.
  | { kind: "winnerOf"; sourceIndex: number };

export type BatchMatchPlan = {
  sideA: BatchSide;
  sideB: BatchSide;
  /** lane index (winner modes only) — court-agnostic until assigned; null = fair mode */
  lane: number | null;
};

// ─── Pro-rated targets ────────────────────────────────────────────────────────

/**
 * A player's presence window for pro-rating: declared per-player start/end wins,
 * else actual check-in time (clamped to the session by clampedSessionMinutes),
 * else the full club session window.
 */
export function resolvePlayerWindow(p: {
  declaredStart: string | null;
  declaredEnd: string | null;
  checkedInHHMM: string | null;
  clubStart: string;
  clubEnd: string;
}): { start: string; end: string } {
  const start = p.declaredStart?.trim() || p.checkedInHHMM?.trim() || p.clubStart;
  const end = p.declaredEnd?.trim() || p.clubEnd;
  return { start, end };
}

/**
 * Pro-rated per-player minimum: N scaled by the fraction of the session the
 * player is present, floored at 1 (everyone present gets at least one game).
 * A degenerate session window (0 minutes) falls back to the full N.
 */
export function computePlayerTarget(
  n: number,
  windowMinutes: number,
  sessionMinutes: number,
): number {
  const base = Math.max(1, Math.round(n));
  if (sessionMinutes <= 0) return base;
  const fraction = Math.min(1, Math.max(0, windowMinutes / sessionMinutes));
  return Math.max(1, Math.round(n * fraction));
}

/** Convenience: window → minutes → target in one call (session times "HH:MM"). */
export function proRatedTarget(
  n: number,
  window: { start: string; end: string },
  clubStart: string,
  clubEnd: string,
): number {
  const sessionMinutes = clampedSessionMinutes(clubStart, clubEnd, clubStart, clubEnd);
  const windowMinutes = clampedSessionMinutes(window.start, window.end, clubStart, clubEnd);
  return computePlayerTarget(n, windowMinutes, sessionMinutes);
}

// ─── Existing-appearance counting (top-up semantics) ─────────────────────────

export type BatchCountableMatch = {
  status: string;
  side_a_player1: string | null;
  side_a_player2: string | null;
  side_b_player1: string | null;
  side_b_player2: string | null;
};

/**
 * Fixed (named-slot) appearances per player across the session: pending +
 * in_progress + completed all count — cancelled doesn't. Winner-placeholder
 * slots are empty and therefore never counted (they're a winner's bonus).
 */
export function countFixedAppearances(
  matches: BatchCountableMatch[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of matches) {
    if (m.status === "cancelled") continue;
    for (const id of [m.side_a_player1, m.side_a_player2, m.side_b_player1, m.side_b_player2]) {
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

// ─── Generator ────────────────────────────────────────────────────────────────

const MAX_PLAN_ITERATIONS = 500;

function sideIds(side: MatchSide): string[] {
  return [side.player1, side.player2].filter((x): x is string => x != null);
}

function toBatchSide(side: MatchSide): BatchSide {
  return { kind: "players", player1: side.player1, player2: side.player2 };
}

export function generateBatchQueue(input: {
  pool: QueuePlayer[];
  settings: ClubQueueSettings;
  lockedPairs: LockedPair[];
  /** per-player shortfall (target − existing fixed appearances), pool ids only */
  remaining: Map<string, number>;
  /** K = club court count — number of winner-chain lanes (winner modes only) */
  laneCount: number;
}): BatchMatchPlan[] {
  const { settings, lockedPairs } = input;
  const ppt = settings.players_per_team;

  // Simulation state: cloned players + remaining shortfalls (pool ids only).
  const simPool: QueuePlayer[] = input.pool.map((p) => ({ ...p }));
  const byId = new Map(simPool.map((p) => [p.id, p]));
  const rem = new Map<string, number>();
  for (const p of simPool) rem.set(p.id, Math.max(0, input.remaining.get(p.id) ?? 0));

  // Synthetic finish stamps continue after the latest real one so simulated
  // matches always read as "played after everything that already happened".
  let simMs = simPool.reduce((mx, p) => {
    const t = p.last_finished_at ? Date.parse(p.last_finished_at) : 0;
    return Number.isNaN(t) ? mx : Math.max(mx, t);
  }, 0);
  const markScheduled = (ids: string[]) => {
    simMs += 60_000;
    const stamp = new Date(simMs).toISOString();
    for (const id of ids) {
      const p = byId.get(id);
      if (!p) continue;
      p.games_played += 1;
      p.last_finished_at = stamp;
      rem.set(id, Math.max(0, (rem.get(id) ?? 0) - 1));
    }
  };

  const someRemaining = () => [...rem.values()].some((v) => v > 0);

  /**
   * Players still short of their target, topped up with fillers (fewest
   * simulated games first) when they can't fill a whole pick on their own —
   * fillers are how uneven division yields N+1 for some players. Returns null
   * when even fillers can't reach `needCount` (caller falls back / stops).
   */
  const pickCandidates = (needCount: number, exclude?: Set<string>): QueuePlayer[] | null => {
    const usable = exclude ? simPool.filter((p) => !exclude.has(p.id)) : simPool;
    const active = usable.filter((p) => (rem.get(p.id) ?? 0) > 0);
    if (active.length >= needCount) return active;
    const fillers = usable
      .filter((p) => (rem.get(p.id) ?? 0) <= 0)
      .sort((a, b) => a.games_played - b.games_played || a.id.localeCompare(b.id));
    const need = needCount - active.length;
    if (fillers.length < need) return null;
    return [...active, ...fillers.slice(0, need)];
  };

  /** A full fixed-vs-fixed match from the fairest candidates, never partial. */
  const planFullMatch = (): MatchSide[] | null => {
    const candidates = pickCandidates(ppt * 2);
    let proposed = candidates
      ? buildNextMatch(candidates, settings, undefined, lockedPairs)
      : null;
    // Candidate subset can strand a locked player whose partner is a filler
    // that wasn't included — the full pool always has every partner present.
    if (!proposed) proposed = buildNextMatch(simPool, settings, undefined, lockedPairs);
    if (!proposed) return null;
    const ids = [...sideIds(proposed.sideA), ...sideIds(proposed.sideB)];
    // Progress guard: a match that covers nobody who still needs games can
    // repeat forever under position-based ordering (fifo) — stop instead.
    if (!ids.some((id) => (rem.get(id) ?? 0) > 0)) return null;
    return [proposed.sideA, proposed.sideB];
  };

  /**
   * One challenger side for a winner-chain match, honouring locks + fairness
   * order. Level-balancing against an unknown winner is impossible, so
   * challengers are taken purely in fairness order (documented behavior).
   */
  const planChallengerSide = (exclude: Set<string>): MatchSide | null => {
    const partnerOf = new Map<string, string>();
    if (ppt === 2) {
      for (const [a, b] of lockedPairs) {
        partnerOf.set(a, b);
        partnerOf.set(b, a);
      }
    }
    const fromPool = (pool: QueuePlayer[]): MatchSide | null => {
      const poolIds = new Set(pool.map((p) => p.id));
      const selectable = pool.filter((p) => {
        const partner = partnerOf.get(p.id);
        return partner == null || poolIds.has(partner);
      });
      const sides = takeSides(orderPool(selectable, settings), partnerOf, 1, ppt);
      return sides ? sides[0] : null;
    };
    const candidates = pickCandidates(ppt, exclude);
    const side = candidates ? fromPool(candidates) : null;
    if (side) return side;
    return fromPool(simPool.filter((p) => !exclude.has(p.id)));
  };

  const plans: BatchMatchPlan[] = [];

  if (!keepsWinner(settings.rotation_mode)) {
    // ── Fair mode: all slots fixed, loop until everyone reaches their target ──
    let guard = 0;
    while (someRemaining() && guard++ < MAX_PLAN_ITERATIONS) {
      const sides = planFullMatch();
      if (!sides) break;
      plans.push({ sideA: toBatchSide(sides[0]), sideB: toBatchSide(sides[1]), lane: null });
      markScheduled([...sideIds(sides[0]), ...sideIds(sides[1])]);
    }
    return plans;
  }

  // ── Lane mode (winner_stays / fair_winner_fallback): K parallel chains ──────
  // Lane j opens with a full match; each later lane match is
  // "winner of the previous lane match" vs fresh challengers. Emission is
  // round-robin across lanes so queue order reads in real play order.
  const laneCount = Math.max(1, input.laneCount);
  const laneLast: (number | null)[] = Array.from({ length: laneCount }, () => null);

  let guard = 0;
  while (someRemaining() && guard++ < MAX_PLAN_ITERATIONS) {
    let progressed = false;
    for (let lane = 0; lane < laneCount; lane++) {
      if (!someRemaining()) break;
      const last = laneLast[lane];
      if (last == null) {
        const sides = planFullMatch();
        if (!sides) continue;
        plans.push({ sideA: toBatchSide(sides[0]), sideB: toBatchSide(sides[1]), lane });
        laneLast[lane] = plans.length - 1;
        markScheduled([...sideIds(sides[0]), ...sideIds(sides[1])]);
        progressed = true;
      } else {
        // HARD exclusion: the previous lane match's fixed players can be the
        // winner that fills this match's placeholder side — drafting them as
        // challengers too could put the same player on BOTH sides. No
        // shortage fallback re-admits them.
        const prev = plans[last];
        const exclude = new Set<string>();
        for (const side of [prev.sideA, prev.sideB]) {
          if (side.kind === "players") {
            exclude.add(side.player1);
            if (side.player2) exclude.add(side.player2);
          }
        }
        const side = planChallengerSide(exclude);
        if (!side) continue;
        const ids = sideIds(side);
        if (!ids.some((id) => (rem.get(id) ?? 0) > 0)) continue;
        plans.push({
          sideA: { kind: "winnerOf", sourceIndex: last },
          sideB: toBatchSide(side),
          lane,
        });
        laneLast[lane] = plans.length - 1;
        // Only the fixed challengers count toward N — the winnerOf slot is the
        // winner's bonus game (locked design decision).
        markScheduled(ids);
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  return plans;
}
