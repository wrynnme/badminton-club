import type { EntityStats } from "@/lib/tournament/entity-stats";

/**
 * Thai labels for match results: ชนะ / แพ้ / เสมอ
 * Shared across all stats view components.
 */
export const RESULT_LABEL_TH: Record<"W" | "L" | "D", string> = {
  W: "ชนะ",
  L: "แพ้",
  D: "เสมอ",
};

/**
 * Tailwind text-color classes per result (with dark-mode variants).
 * Used for the inline result column in match-history rows.
 */
export const RESULT_TEXT_CLASS: Record<"W" | "L" | "D", string> = {
  W: "text-green-600 dark:text-green-400 font-semibold",
  L: "text-red-600 dark:text-red-400 font-semibold",
  D: "text-yellow-600 dark:text-yellow-400 font-semibold",
};

/**
 * Tailwind pill (bg + text) classes per result — used by `<StreakPill>`.
 */
export const RESULT_PILL_CLASS: Record<"W" | "L" | "D", string> = {
  W: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  L: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  D: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
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
