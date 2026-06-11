"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { divisionLabelTh, divisionTone, parseDivision } from "@/lib/tournament/divisions";
import type { PairStats } from "@/lib/tournament/entity-stats";
import type { PairWithPlayers } from "@/lib/types";
import { StreakPill } from "./shared/streak-pill";
import { StatHeaderCards } from "./shared/stat-header-cards";
import { MatchHistoryList, type CompetitorEntry } from "./shared/match-history-list";
import { HeadToHeadTable, type HeadToHeadRow } from "./shared/head-to-head-table";
import { PairScheduleLink } from "@/components/tournament/pair-schedule-link";
import { CalendarClock } from "lucide-react";

export function PairStatsView({
  stats,
  pair,
  competitorById,
}: {
  stats: PairStats;
  pair: PairWithPlayers;
  competitorById: Map<string, CompetitorEntry>;
}) {
  const t = useTranslations("stats");

  const pairName =
    pair.display_pair_name ||
    [pair.player1?.display_name, pair.player2?.display_name]
      .filter(Boolean)
      .join(" / ") ||
    t("pairView.unnamedPair");

  const playerNames = [pair.player1?.display_name, pair.player2?.display_name]
    .filter(Boolean)
    .join(" & ");

  // Infer division from first match that has one set
  const firstDivisionMatch = stats.matches.find((m) => m.division != null);
  const divNum = parseDivision(firstDivisionMatch?.division ?? null);
  const tone = divNum ? divisionTone(divNum) : null;

  const h2hRows: HeadToHeadRow[] = Object.entries(stats.headToHead)
    .map(([opponentId, h2h]) => ({
      id: opponentId,
      name: competitorById.get(opponentId)?.name ?? opponentId,
      ...h2h,
    }))
    .sort((a, b) => b.played - a.played);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header card */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-bold">{pairName}</h1>
              {pair.display_pair_name && playerNames && (
                <p className="text-sm text-muted-foreground mt-0.5">{playerNames}</p>
              )}
            </div>
            {divNum && tone && (
              <Badge
                variant="outline"
                className={`${tone.border} ${tone.bg} ${tone.text} shrink-0`}
              >
                {divisionLabelTh(divNum)}
              </Badge>
            )}
          </div>

          {pair.pair_level && (
            <p className="text-xs text-muted-foreground">
              {t("pairView.pairLevelLabel")}{" "}
              <span className="font-medium text-foreground">{pair.pair_level}</span>
            </p>
          )}

          {/* my-matches-link: ดูตารางแข่ง cross-link — ลบ block นี้เพื่อถอด entry point */}
          <PairScheduleLink pairId={stats.entityId} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <CalendarClock className="size-3.5" />
            {t("pairView.scheduleLink")}
          </PairScheduleLink>
          {/* end my-matches-link */}
        </CardContent>
      </Card>

      <StatHeaderCards stats={stats} />

      {/* Streak pill */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("shared.streakLabel")}</span>
        <StreakPill streak={stats.streak} />
      </div>

      <MatchHistoryList
        matches={stats.matches}
        isSideA={(m) => m.pair_a_id === stats.entityId}
        competitorById={competitorById}
      />

      <HeadToHeadTable
        title={t("pairView.h2hTitle")}
        rows={h2hRows}
        entityType="pair"
      />
    </div>
  );
}
