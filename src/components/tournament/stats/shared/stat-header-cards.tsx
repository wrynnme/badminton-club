"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EntityStats } from "@/lib/tournament/entity-stats";
import { formatWinRate, formatWlLabel } from "@/lib/tournament/result-display";

/**
 * Default Thai labels shared by the pair/player/team stat views.
 * Division view passes its own overrides for the 4 slots.
 */
export const DEFAULT_STAT_HEADER_LABELS = {
  played: "แมตช์",
  record: "ผลงาน",
  winRate: "อัตราชนะ",
  pointsDiff: "ต่างคะแนน",
} as const;

export type StatHeaderLabels = {
  played: string;
  record: string;
  winRate: string;
  pointsDiff: string;
};

/**
 * 4-stat-card grid: played · W/D/L · win rate · point diff.
 * Used at the top of every entity stats view (pair/player/team).
 *
 * `hideWinRate` collapses to a 3-card layout (played · record · point diff) —
 * use for entity types where win-rate is undefined or meaningless (e.g. division
 * aggregates, where every decisive match contributes one W + one L).
 *
 * Division view supplies its own labels via the `labels` prop and computes
 * its own values, so it currently uses its own implementation.
 */
export function StatHeaderCards({
  stats,
  labels = DEFAULT_STAT_HEADER_LABELS,
  hideWinRate = false,
}: {
  stats: EntityStats;
  labels?: StatHeaderLabels;
  hideWinRate?: boolean;
}) {
  const wlLabel = formatWlLabel(stats);
  const diff = stats.pointsDiff;
  const diffClass =
    diff > 0
      ? "text-green-600 dark:text-green-400"
      : diff < 0
      ? "text-red-600 dark:text-red-400"
      : "";

  const gridCols = hideWinRate
    ? "grid grid-cols-2 sm:grid-cols-3 gap-3"
    : "grid grid-cols-2 sm:grid-cols-4 gap-3";

  return (
    <div className={gridCols}>
      <Card>
        <CardHeader className="pb-1 pt-4 px-4">
          <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
            {labels.played}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-3xl font-bold tabular-nums">{stats.played}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-1 pt-4 px-4">
          <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
            {labels.record}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-xl font-bold tabular-nums">{wlLabel}</p>
        </CardContent>
      </Card>

      {!hideWinRate && (
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              {labels.winRate}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-3xl font-bold tabular-nums">
              {formatWinRate(stats.winRate)}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-1 pt-4 px-4">
          <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
            {labels.pointsDiff}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className={`text-3xl font-bold tabular-nums ${diffClass}`}>
            {diff > 0 ? "+" : ""}
            {diff}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
