import type { MatchFormat } from "@/lib/types";
import type { Game } from "@/lib/types";

/**
 * Per-format game-count rules. The WINNER of a match is always "most games won"
 * (see `gameWinner` in scoring.ts) — that counting is format-agnostic. What the
 * format constrains is how many games are PLAYED and whether a draw is a valid
 * result:
 *   - fixed_2:    exactly 2 games, 1-1 is a legitimate draw (group/league play)
 *   - best_of_3:  first side to win 2 games (max 3 played), no draw
 *   - best_of_5:  first side to win 3 games (max 5 played), no draw
 */
export const MATCH_FORMAT_BOUNDS: Record<
  MatchFormat,
  { maxGames: number; winAt: number; canDraw: boolean }
> = {
  fixed_2: { maxGames: 2, winAt: 2, canDraw: true },
  best_of_3: { maxGames: 3, winAt: 2, canDraw: false },
  best_of_5: { maxGames: 5, winAt: 3, canDraw: false },
};

/** Max number of game rows allowed for a format — used to clamp ScoreForm. */
export function maxGamesForFormat(format: MatchFormat): number {
  return MATCH_FORMAT_BOUNDS[format].maxGames;
}

/**
 * Is `games` a complete, valid result for this format?
 *  - never more games than `maxGames`
 *  - fixed_2: needs both games entered (1-1 counts as a complete draw)
 *  - best_of_3 / best_of_5: a side must have reached the clinch (`winAt`)
 * BYE walkovers (empty array) are NOT complete here — callers filter those separately.
 */
export function isMatchComplete(games: Game[], format: MatchFormat): boolean {
  const { maxGames, winAt, canDraw } = MATCH_FORMAT_BOUNDS[format];
  if (games.length === 0 || games.length > maxGames) return false;
  let a = 0;
  let b = 0;
  for (const g of games) {
    if (g.a > g.b) a++;
    else if (g.b > g.a) b++;
  }
  if (canDraw) return games.length === maxGames;
  return a === winAt || b === winAt;
}

export type MatchResult =
  | { ok: true; winner: "a" | "b" | "draw" }
  | { ok: false; reason: string };

/**
 * Validate `games` against a competition class's `match_format` and resolve the
 * winner in one pass. Used at score-entry time for class matches (sports_day
 * matches stay on the lenient `gameWinner` majority path — no format to enforce).
 *
 * Rejects (with a Thai reason):
 *  - no games at all
 *  - any individual tied game (g.a === g.b is a malformed score, never a draw)
 *  - more games than the format allows
 *  - fixed_2 with ≠ 2 games
 *  - best_of_N where neither side reached the clinch
 * Returns winner "a" | "b" | "draw" ("draw" only possible for fixed_2 at 1-1).
 */
export function resolveMatchResult(games: Game[], format: MatchFormat): MatchResult {
  const { maxGames, winAt, canDraw } = MATCH_FORMAT_BOUNDS[format];
  if (games.length === 0) return { ok: false, reason: "ต้องมีอย่างน้อย 1 เกม" };
  for (const g of games) {
    if (g.a === g.b) return { ok: false, reason: "แต่ละเกมต้องมีผู้ชนะ (คะแนนเท่ากันไม่ได้)" };
  }
  if (games.length > maxGames) {
    return { ok: false, reason: `รูปแบบนี้เล่นได้ไม่เกิน ${maxGames} เกม` };
  }

  let a = 0;
  let b = 0;
  for (const g of games) {
    if (g.a > g.b) a++;
    else b++; // tied games already rejected above
  }

  if (canDraw) {
    // fixed_2: both games must be played; 2-0 / 0-2 → winner, 1-1 → draw.
    if (games.length !== maxGames) {
      return { ok: false, reason: `รูปแบบนี้ต้องเล่น ${maxGames} เกม` };
    }
    if (a > b) return { ok: true, winner: "a" };
    if (b > a) return { ok: true, winner: "b" };
    return { ok: true, winner: "draw" };
  }

  // best_of_N: a side must reach the clinch to end the match.
  if (a >= winAt) return { ok: true, winner: "a" };
  if (b >= winAt) return { ok: true, winner: "b" };
  return { ok: false, reason: `ต้องชนะให้ครบ ${winAt} เกมจึงจะจบแมตช์` };
}
