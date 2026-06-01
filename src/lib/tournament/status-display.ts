import type { Match } from "@/lib/types";

/**
 * Canonical match-status labels + pill classes — single source of truth.
 *
 * Replaces the divergent inline palettes that used to live in `match-queue.tsx`
 * (in_progress=amber / completed=green) and `tv-match-card.tsx`
 * (in_progress=green / completed=zinc). Now every surface shows the same three
 * states with the same D2 tokens.
 *
 * Tokens are theme-aware (light/dark baked into the var) so callers need NO
 * `dark:` variants. `--live` is reserved for the scoreboard glow/pulse accent;
 * the in-progress pill itself uses the readable `--success` text on a vivid
 * `--live` tint.
 */
export const MATCH_STATUS_LABEL_TH: Record<Match["status"], string> = {
  pending: "รอแข่ง",
  in_progress: "กำลังแข่ง",
  completed: "จบแล้ว",
};

export const MATCH_STATUS_PILL_CLASS: Record<Match["status"], string> = {
  pending: "bg-warning/15 text-warning",
  in_progress: "bg-live/15 text-success",
  completed: "bg-muted text-muted-foreground",
};
