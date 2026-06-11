import type { TournamentStatus } from "@/lib/types";

/**
 * Tournament status labels have been moved to the next-intl catalog under
 * `tournament.tournamentStatus.*`. Use `t(\`tournamentStatus.${status}\`)` in consumers.
 *
 * Note: `src/lib/actions/tournaments.ts` (notifyTournamentEvent on status
 * change) uses a divergent set ("ร่าง" / "เปิดรับสมัคร" / "กำลังแข่งขัน" /
 * "จบการแข่งขัน") because LINE notifications historically used the longer
 * forms. That divergence is kept inline at its call site.
 */

/**
 * Badge variants paired with the `tournament.tournamentStatus.*` catalog
 * labels. Consumed by the tournament list and detail page header.
 */
export const TOURNAMENT_STATUS_BADGE: Record<
  TournamentStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  registering: "secondary",
  ongoing: "default",
  completed: "destructive",
};
