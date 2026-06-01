import type { Match } from "@/lib/types";

/**
 * Partition a tournament's matches into the three lifecycle buckets for a single pair.
 *
 * Pure helper — does not mutate the input array (sorts operate on copies).
 *
 * - `inProgress`: belongs && status === "in_progress", sorted by `match_number` asc
 * - `pending`:    belongs && status === "pending",     sorted by `(queue_position ?? match_number)` asc
 * - `completed`:  belongs && status === "completed" && games.length > 0 (BYE walkovers EXCLUDED),
 *                 sorted by `match_number` asc
 *
 * `belongs` = the pair sits on either side of the match (`pair_a_id === pairId || pair_b_id === pairId`).
 *
 * BYE exclusion matters: a walkover is stored as `status="completed"` with `games=[]`, and
 * `gameWinner([])` resolves to a bogus 0–0 "draw" — so completed BYEs must be filtered out here.
 */
export function partitionPairMatches(
  matches: Match[],
  pairId: string,
): { inProgress: Match[]; pending: Match[]; completed: Match[] } {
  const belongs = (m: Match) => m.pair_a_id === pairId || m.pair_b_id === pairId;

  const inProgress = matches
    .filter((m) => belongs(m) && m.status === "in_progress")
    .sort((a, b) => a.match_number - b.match_number);

  const pending = matches
    .filter((m) => belongs(m) && m.status === "pending")
    .sort(
      (a, b) =>
        (a.queue_position ?? a.match_number) - (b.queue_position ?? b.match_number),
    );

  const completed = matches
    .filter((m) => belongs(m) && m.status === "completed" && m.games.length > 0)
    .sort((a, b) => a.match_number - b.match_number);

  return { inProgress, pending, completed };
}
