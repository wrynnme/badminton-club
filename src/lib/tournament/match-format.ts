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

export const MATCH_FORMAT_LABEL_TH: Record<MatchFormat, string> = {
  fixed_2: "2 เกมรวด",
  best_of_3: "Best of 3 (ชนะ 2)",
  best_of_5: "Best of 5 (ชนะ 3)",
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
