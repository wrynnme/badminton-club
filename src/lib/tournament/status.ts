import type { TournamentStatus } from "@/lib/types";

/**
 * Canonical Thai labels for `TournamentStatus`. Used in tournament list cards,
 * detail header badge, and public TV/bracket headers — these all rendered
 * identical strings before consolidation.
 *
 * Note: `src/lib/actions/tournaments.ts` (notifyTournamentEvent on status
 * change) uses a divergent set ("ร่าง" / "เปิดรับสมัคร" / "กำลังแข่งขัน" /
 * "จบการแข่งขัน") because LINE notifications historically used the longer
 * forms. That divergence is kept inline at its call site.
 */
export const TOURNAMENT_STATUS_LABEL: Record<TournamentStatus, string> = {
  draft: "แบบร่าง",
  registering: "เปิดรับสมัคร",
  ongoing: "กำลังแข่ง",
  completed: "จบแล้ว",
};

/**
 * Badge variants paired with `TOURNAMENT_STATUS_LABEL`. Consumed by the
 * tournament list and detail page header.
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
