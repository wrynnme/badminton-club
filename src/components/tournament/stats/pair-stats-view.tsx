"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { divisionLabelTh, divisionTone, parseDivision } from "@/lib/tournament/divisions";
import type { EntityStats } from "@/lib/tournament/entity-stats";
import type { PairWithPlayers } from "@/lib/types";
import { StreakPill } from "./shared/streak-pill";
import { StatHeaderCards } from "./shared/stat-header-cards";
import { MatchHistoryList, type CompetitorEntry } from "./shared/match-history-list";
import { HeadToHeadTable, type HeadToHeadRow } from "./shared/head-to-head-table";

export function PairStatsView({
  stats,
  pair,
  competitorById,
}: {
  stats: EntityStats;
  pair: PairWithPlayers;
  competitorById: Map<string, CompetitorEntry>;
}) {
  const pairName =
    pair.display_pair_name ||
    [pair.player1?.display_name, pair.player2?.display_name]
      .filter(Boolean)
      .join(" / ") ||
    "คู่ไม่มีชื่อ";

  const playerNames = [pair.player1?.display_name, pair.player2?.display_name]
    .filter(Boolean)
    .join(" & ");

  // Infer division from first match that has one set
  const firstDivisionMatch = stats.matches.find((m) => m.division != null);
  const divNum = parseDivision(firstDivisionMatch?.division ?? null);
  const tone = divNum ? divisionTone(divNum) : null;

  const h2hRows: HeadToHeadRow[] = Array.from(stats.headToHead.entries())
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
        <CardContent className="pt-6 space-y-3">
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
              ระดับคู่:{" "}
              <span className="font-medium text-foreground">{pair.pair_level}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <StatHeaderCards stats={stats} />

      {/* Streak pill */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">สถิติต่อเนื่อง:</span>
        <StreakPill streak={stats.streak} />
      </div>

      <MatchHistoryList
        matches={stats.matches}
        isSideA={(m) => m.pair_a_id === stats.entityId}
        competitorById={competitorById}
      />

      <HeadToHeadTable title="พบกัน (Head-to-Head)" rows={h2hRows} />
    </div>
  );
}
