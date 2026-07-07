import type { ClubQueueSettings } from "./queue-settings";
import {
  buildNextMatch,
  orderPool,
  queueTierKey,
  takeSides,
  keepsWinner,
  type QueuePlayer,
  type MatchSide,
  type LockedPair,
} from "./queue";
import {
  clonePairHistory,
  emptyPairHistory,
  pairingCost,
  partnerCost,
  recordPairing,
  recordSidePartner,
  type PairHistory,
} from "./pair-history";
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

/**
 * Session pairing memory seeded from the matches already on the board (pending +
 * in_progress + completed; cancelled skipped). Feeds the generator's variety
 * scoring so a fresh "สุ่มคิว" top-up avoids the partnerships/oppositions that
 * are already queued or played tonight. Winner-placeholder slots are empty and
 * contribute nothing (a match with one empty side records no opposition).
 */
export function buildPairHistory(matches: BatchCountableMatch[]): PairHistory {
  const hist = emptyPairHistory();
  for (const m of matches) {
    if (m.status === "cancelled") continue;
    recordPairing(
      hist,
      { player1: m.side_a_player1, player2: m.side_a_player2 },
      { player1: m.side_b_player1, player2: m.side_b_player2 },
    );
  }
  return hist;
}

// ─── Generator ────────────────────────────────────────────────────────────────

const MAX_PLAN_ITERATIONS = 500;

// Variety window: how far past the fairness cutoff we may reach to avoid a
// repeat, and a hard cap on candidate matches enumerated per pick. The anchor
// (fairness-first) always stays in — the window only reshuffles the players of
// near-equal fairness around it, so the "everyone plays N games" guarantee and
// the queue-mode ordering are never overridden by variety.
const VARIETY_WINDOW_SLACK = 4;
const MAX_VARIETY_CANDIDATES = 64;

function sideIds(side: MatchSide): string[] {
  return [side.player1, side.player2].filter((x): x is string => x != null);
}

function toBatchSide(side: MatchSide): BatchSide {
  return { kind: "players", player1: side.player1, player2: side.player2 };
}

/** Deterministic size-k subsets of `arr` (lexicographic by index). */
function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  const n = arr.length;
  if (k < 0 || k > n) return;
  if (k === 0) {
    yield [];
    return;
  }
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map((i) => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

export function generateBatchQueue(input: {
  pool: QueuePlayer[];
  settings: ClubQueueSettings;
  lockedPairs: LockedPair[];
  /** per-player shortfall (target − existing fixed appearances), pool ids only */
  remaining: Map<string, number>;
  /** K = club court count — number of winner-chain lanes (winner modes only) */
  laneCount: number;
  /**
   * Session pairing memory (who has partnered / opposed whom). Seeds variety
   * scoring; kept updated as matches are planned. Omit = no history = the
   * generator still spreads pairings across the batch it creates.
   */
  history?: PairHistory;
}): BatchMatchPlan[] {
  const { settings, lockedPairs } = input;
  const ppt = settings.players_per_team;

  // Simulation state: cloned players + remaining shortfalls (pool ids only).
  const simPool: QueuePlayer[] = input.pool.map((p) => ({ ...p }));
  const byId = new Map(simPool.map((p) => [p.id, p]));
  const rem = new Map<string, number>();
  for (const p of simPool) rem.set(p.id, Math.max(0, input.remaining.get(p.id) ?? 0));

  // Variety memory: own clone so we never mutate the caller's seed; updated as
  // each match is planned so within-batch repeats are penalised too.
  const hist = clonePairHistory(input.history);
  // Fast locked-partner lookup (doubles only) for window forcing.
  const lockedPartner = new Map<string, string>();
  if (ppt === 2) {
    for (const [a, b] of lockedPairs) {
      lockedPartner.set(a, b);
      lockedPartner.set(b, a);
    }
  }

  // Synthetic finish stamps continue after the latest real one so simulated
  // matches always read as "played after everything that already happened".
  let simMs = simPool.reduce((mx, p) => {
    const t = p.last_finished_at ? Date.parse(p.last_finished_at) : 0;
    return Number.isNaN(t) ? mx : Math.max(mx, t);
  }, 0);
  // Ids of the most-recently-scheduled match — kept out of the next variety
  // window so nobody is drafted into back-to-back matches (rest-spacing). This
  // is what enforces "no adjacent repeat" now that the fairness tier is keyed on
  // games-played (equally-owed players share a tier) instead of finish stamps.
  let justPlayed = new Set<string>();
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
    justPlayed = new Set(ids);
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

  /**
   * A full fixed-vs-fixed match, never partial. Variety-aware: the fairness-first
   * anchor always stays in (queue-mode primacy), but among the near-fairness
   * players in its window the generator picks the grouping+split whose
   * partnerships/oppositions repeat the least. The level rules are unchanged —
   * every candidate still goes through buildNextMatch, so a strict skill-gap
   * ceiling keeps filtering; variety only chooses among what it allows. Falls
   * back to the plain fairest pick when the window forms no valid match (locks).
   */
  const planFullMatch = (): MatchSide[] | null => {
    const need = ppt * 2;
    const candidates = pickCandidates(need);

    if (candidates && candidates.length >= need) {
      const ordered = orderPool(candidates, settings);

      // Tier boundary: every player ranked strictly ABOVE the marginal (need-th)
      // pick must play — that's queue-mode order, which outranks variety. Variety
      // only permutes players inside the marginal player's own tier (equal rest /
      // equal queue position), so it never puts a less-rested player on court
      // ahead of a more-rested one. Early on, everyone who hasn't played shares
      // one tier → the window is the whole bench; mid-session it narrows.
      const cutoffKey = queueTierKey(ordered[need - 1], settings);
      let firstTierIdx = 0;
      while (
        firstTierIdx < ordered.length &&
        queueTierKey(ordered[firstTierIdx], settings) !== cutoffKey
      ) {
        firstTierIdx++;
      }
      const forced = ordered.slice(0, firstTierIdx);
      const tier = ordered.filter((p) => queueTierKey(p, settings) === cutoffKey);
      const fillCount = need - forced.length;
      // Rest-spacing: drop the previous match's players from the window so nobody
      // plays back-to-back — but only while enough equally-owed players remain to
      // still fill the pick. A bench too small to space out (e.g. 8 players, one
      // rested foursome) falls back to the full tier, so variety there rotates
      // the split within the fixed foursome instead of stalling.
      let eligible = tier.filter((p) => !justPlayed.has(p.id));
      if (eligible.length < fillCount) eligible = tier;
      // Cap enumeration so an all-rested bench stays cheap.
      const choosable = eligible.slice(0, fillCount + VARIETY_WINDOW_SLACK);

      let best:
        | { sides: [MatchSide, MatchSide]; cost: number; remSum: number; key: string }
        | null = null;
      let tried = 0;
      if (fillCount >= 0 && choosable.length >= fillCount) {
        for (const combo of combinations(choosable, fillCount)) {
          if (tried++ >= MAX_VARIETY_CANDIDATES) break;
          const subset = [...forced, ...combo];
          const m = buildNextMatch(subset, settings, undefined, lockedPairs, hist);
          if (!m) continue;
          const ids = [...sideIds(m.sideA), ...sideIds(m.sideB)];
          // Progress guard: skip a match that covers nobody still needing games.
          if (!ids.some((id) => (rem.get(id) ?? 0) > 0)) continue;
          const cost = pairingCost(hist, m.sideA, m.sideB);
          // Efficiency tiebreak: among equally-fresh matchups prefer the one
          // that serves the neediest players (highest total shortfall). This
          // keeps the "everyone plays N" budget draining evenly so variety
          // doesn't strand a remainder into extra matches.
          const remSum = ids.reduce((s, id) => s + (rem.get(id) ?? 0), 0);
          const key = [...ids].sort().join(",");
          const better =
            best == null ||
            cost < best.cost ||
            (cost === best.cost && remSum > best.remSum) ||
            (cost === best.cost && remSum === best.remSum && key < best.key);
          if (better) best = { sides: [m.sideA, m.sideB], cost, remSum, key };
        }
      }
      if (best) return best.sides;
    }

    // Fallback: original fairest pick — candidate subset, then the full pool (a
    // locked player's partner may be a filler the window left out).
    let proposed = candidates
      ? buildNextMatch(candidates, settings, undefined, lockedPairs, hist)
      : null;
    if (!proposed) proposed = buildNextMatch(simPool, settings, undefined, lockedPairs, hist);
    if (!proposed) return null;
    const ids = [...sideIds(proposed.sideA), ...sideIds(proposed.sideB)];
    if (!ids.some((id) => (rem.get(id) ?? 0) > 0)) return null;
    return [proposed.sideA, proposed.sideB];
  };

  /**
   * One challenger side for a winner-chain match. The opponent is a not-yet-known
   * promoted winner, so opposition variety can't be planned — but the challenger
   * PAIR's own partnership can: among near-fairness free players, pick the pair
   * that has teamed up the least. Locks + fairness order are still honoured.
   */
  const planChallengerSide = (exclude: Set<string>): MatchSide | null => {
    const partnerOf = lockedPartner;

    const buildSide = (pool: QueuePlayer[]): MatchSide | null => {
      const poolIds = new Set(pool.map((p) => p.id));
      const selectable = pool.filter((p) => {
        const partner = partnerOf.get(p.id);
        return partner == null || poolIds.has(partner);
      });
      const ordered = orderPool(selectable, settings);
      if (ordered.length < ppt) return null;
      if (ppt === 1) return { player1: ordered[0].id, player2: null };

      const anchor = ordered[0];
      const lockId = partnerOf.get(anchor.id);
      if (lockId) return { player1: anchor.id, player2: lockId }; // locked pair fixed

      // Free anchor: least-repeated free partner from the fairness window.
      const window = ordered.slice(1, Math.min(ordered.length, 2 + VARIETY_WINDOW_SLACK));
      let best: { side: MatchSide; cost: number; key: string } | null = null;
      for (const cand of window) {
        if (partnerOf.get(cand.id)) continue; // locked players pair only with their lock
        const side: MatchSide = { player1: anchor.id, player2: cand.id };
        const cost = partnerCost(hist, side);
        const key = [anchor.id, cand.id].sort().join(",");
        if (best == null || cost < best.cost || (cost === best.cost && key < best.key)) {
          best = { side, cost, key };
        }
      }
      if (best) return best.side;
      // Fallback: original greedy side (all-locked window edge case).
      const sides = takeSides(ordered, partnerOf, 1, ppt);
      return sides ? sides[0] : null;
    };

    const candidates = pickCandidates(ppt, exclude);
    const side = candidates ? buildSide(candidates) : null;
    if (side) return side;
    return buildSide(simPool.filter((p) => !exclude.has(p.id)));
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
      recordPairing(hist, sides[0], sides[1]);
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
        recordPairing(hist, sides[0], sides[1]);
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
        // Record only the challenger pair's partnership — the opponent is the
        // yet-unknown promoted winner, so opposition can't be counted here.
        recordSidePartner(hist, side);
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  return plans;
}
