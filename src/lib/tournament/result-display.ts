import type { EntityStats } from "@/lib/tournament/entity-stats";

/**
 * Labels for match results have been moved to the next-intl catalog under
 * `tournament.result.*`. Use `t(\`result.${r}\`)` in consumers.
 */

/**
 * Tailwind text-color classes per result (with dark-mode variants).
 * Used for the inline result column in match-history rows.
 */
export const RESULT_TEXT_CLASS: Record<"W" | "L" | "D", string> = {
  W: "text-winner font-semibold",
  L: "text-destructive font-semibold",
  D: "text-warning font-semibold",
};

/**
 * Tailwind pill (bg + text) classes per result — used by `<StreakPill>`.
 * Semantic tokens are theme-aware (light/dark baked into the var) — no `dark:` needed.
 */
export const RESULT_PILL_CLASS: Record<"W" | "L" | "D", string> = {
  W: "bg-winner/15 text-winner",
  L: "bg-destructive/15 text-destructive",
  D: "bg-warning/15 text-warning",
};

/**
 * Format win-rate 0..1 as percentage string ("57%"). 0 → "0%".
 */
export function formatWinRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * Format the W/D/L summary chip used in the "ผลงาน" stat card.
 * Returns "—" when no completed matches yet.
 * Examples: "2W 1L" · "2W 1D 1L"
 */
export function formatWlLabel(stats: EntityStats): string {
  if (stats.played === 0) return "—";
  const draws = stats.draws > 0 ? ` ${stats.draws}D` : "";
  return `${stats.wins}W${draws} ${stats.losses}L`;
}
