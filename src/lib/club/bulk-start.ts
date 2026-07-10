/**
 * Pure court-assignment planner for bulk-starting many pending club matches at once.
 *
 * The sharp edge of a bulk start is the two DB invariants that a naive "start each
 * selected match" loop would trip on:
 *   1. the partial UNIQUE index (club_id, court) WHERE status='in_progress' — one
 *      live match per court;
 *   2. the `club_player_busy` trigger — a player may be in only one in_progress
 *      match of the club at a time.
 *
 * This planner walks the selected matches in queue order and decides, up front,
 * which ones can start and on which court, so the action never fires an update it
 * knows the DB would reject. It keeps NO DB access — everything it needs (roster
 * fullness, live-placeholder status, current occupancy) is resolved by the caller
 * and passed in, which makes the tricky allocation logic unit-testable in isolation.
 *
 * Rules (in walk order):
 *   - skip a match still waiting on a winner (a live feeder points at it);
 *   - skip a match whose roster is not full;
 *   - skip a match sharing a player with an already-busy player (either a live
 *     in_progress match, or a match started earlier in this same batch);
 *   - assign the match its own court if that court is free, else the next free
 *     named court; skip if no court is free.
 * A court is "free" when it is not held by a current in_progress match and not
 * already claimed by an earlier match in this batch.
 */

export type BulkStartSkipReason =
  | "waiting_winner"
  | "not_full"
  | "player_busy"
  | "no_court";

export type BulkStartCandidate = {
  id: string;
  /** the match's currently-assigned court (may be null / courtless) */
  court: string | null;
  /** non-null player ids on the match — used for cross-batch busy detection */
  playerIds: string[];
  /** roster complete for the club's players_per_team (isClubMatchFull) */
  isFull: boolean;
  /** a live feeder (pending/in_progress) still points at this match */
  hasLivePlaceholder: boolean;
};

export type BulkStartPlan = {
  /** matches to transition to in_progress, each with the court to run it on */
  toStart: Array<{ id: string; court: string }>;
  /** matches that cannot start, with why (for the "ข้าม Y" toast) */
  skipped: Array<{ id: string; reason: BulkStartSkipReason }>;
};

/**
 * Decide which selected matches can bulk-start and on which court.
 *
 * @param candidates    selected matches, already ordered by queue position
 * @param courts        the club's resolved named courts (never empty after resolveClubCourts)
 * @param occupiedCourts courts currently held by an in_progress match
 * @param busyPlayerIds  players currently in an in_progress match (seed the busy set)
 */
export function planBulkStartCourts(
  candidates: BulkStartCandidate[],
  courts: string[],
  occupiedCourts: string[],
  busyPlayerIds: string[] = [],
): BulkStartPlan {
  const claimedCourts = new Set(occupiedCourts);
  const busyPlayers = new Set(busyPlayerIds);
  const toStart: BulkStartPlan["toStart"] = [];
  const skipped: BulkStartPlan["skipped"] = [];

  for (const c of candidates) {
    if (c.hasLivePlaceholder) {
      skipped.push({ id: c.id, reason: "waiting_winner" });
      continue;
    }
    if (!c.isFull) {
      skipped.push({ id: c.id, reason: "not_full" });
      continue;
    }
    if (c.playerIds.some((p) => busyPlayers.has(p))) {
      skipped.push({ id: c.id, reason: "player_busy" });
      continue;
    }

    // Keep the match's own court when it's free; otherwise take the next free
    // named court. A free-text court the match already holds counts even if it is
    // not in the club's named list.
    const own = c.court?.trim() ? c.court : null;
    const court =
      own && !claimedCourts.has(own)
        ? own
        : (courts.find((crt) => !claimedCourts.has(crt)) ?? null);
    if (!court) {
      skipped.push({ id: c.id, reason: "no_court" });
      continue;
    }

    claimedCourts.add(court);
    for (const p of c.playerIds) busyPlayers.add(p);
    toStart.push({ id: c.id, court });
  }

  return { toStart, skipped };
}
