import type { Level } from "@/lib/types";

/**
 * Resolve a club's ACTIVE level set from rows fetched with
 * `.or(\`club_id.eq.\${clubId},club_id.is.null\`)`: club-scoped rows win when the
 * club has customized its ladder; otherwise the global rows (club_id NULL) are
 * the active set — the same fallback rule as `getClubLevelsAction`.
 *
 * Used to validate a submitted `level_id` before writing it to
 * `club_players.level_id`: the FK alone would accept any levels row, including
 * another club's.
 */
export function resolveActiveLevelIds(
  rows: Pick<Level, "id" | "club_id">[],
): Set<string> {
  const clubRows = rows.filter((r) => r.club_id != null);
  return new Set((clubRows.length > 0 ? clubRows : rows).map((r) => r.id));
}
