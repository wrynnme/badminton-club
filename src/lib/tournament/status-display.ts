import type { Match } from "@/lib/types";

/**
 * Canonical match-status pill classes — single source of truth.
 *
 * Labels have been moved to the next-intl catalog under
 * `tournament.matchStatus.*`. Use `t(\`matchStatus.${match.status}\`)` in consumers.
 *
 * Tokens are theme-aware (light/dark baked into the var) so callers need NO
 * `dark:` variants. `--live` is reserved for the scoreboard glow/pulse accent;
 * the in-progress pill itself uses the readable `--success` text on a vivid
 * `--live` tint.
 */
export const MATCH_STATUS_PILL_CLASS: Record<Match["status"], string> = {
  pending: "bg-warning/15 text-warning",
  in_progress: "bg-live/15 text-success",
  completed: "bg-muted text-muted-foreground",
};
