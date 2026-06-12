"use client";

import { useTranslations } from "next-intl";
import { RESULT_PILL_CLASS } from "@/lib/tournament/result-display";

/**
 * Inline pill summarizing the entity's current win/loss/draw streak.
 * Renders an em-dash placeholder when there is no streak.
 */
export function StreakPill({
  streak,
}: {
  streak: { type: "W" | "L" | "D" | null; length: number };
}) {
  const t = useTranslations("stats.shared");
  const tTournament = useTranslations("tournament");

  if (!streak.type || streak.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm font-semibold ${RESULT_PILL_CLASS[streak.type]}`}
    >
      {tTournament(`result.${streak.type}`)} {t("streakSuffix", { count: streak.length })}
    </span>
  );
}
