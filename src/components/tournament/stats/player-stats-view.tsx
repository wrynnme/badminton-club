"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { PlayerStats } from "@/lib/tournament/entity-stats";
import type { Level, TeamPlayer, Team, PairWithPlayers } from "@/lib/types";
import { StreakPill } from "./shared/streak-pill";
import { StatHeaderCards } from "./shared/stat-header-cards";
import { MatchHistoryList, type CompetitorEntry } from "./shared/match-history-list";
import { HeadToHeadTable, type HeadToHeadRow } from "./shared/head-to-head-table";

export function PlayerStatsView({
  stats,
  player,
  team,
  pairById,
  competitorById,
  levels,
}: {
  stats: PlayerStats;
  player: TeamPlayer;
  team: Team | undefined;
  pairById: Map<string, PairWithPlayers>;
  competitorById: Map<string, CompetitorEntry>;
  levels: Level[];
}) {
  // Set of pair IDs this player belongs to — needed for side detection in match rows
  const playerPairIds = new Set<string>();
  for (const [id, p] of pairById) {
    if (p.player_id_1 === player.id || p.player_id_2 === player.id) {
      playerPairIds.add(id);
    }
  }

  // Build player-name lookup from pairs (for partner breakdown display)
  const playerNameById = new Map<string, string>();
  for (const p of pairById.values()) {
    if (p.player1) playerNameById.set(p.player1.id, p.player1.display_name);
    if (p.player2) playerNameById.set(p.player2.id, p.player2.display_name);
  }

  const h2hRows: HeadToHeadRow[] = Object.entries(stats.headToHead)
    .map(([opponentId, h2h]) => ({
      id: opponentId,
      name: competitorById.get(opponentId)?.name ?? opponentId,
      ...h2h,
    }))
    .sort((a, b) => b.played - a.played);

  const partnerRows: HeadToHeadRow[] = Object.entries(stats.partnerBreakdown)
    .map(([partnerId, pb]) => ({
      id: partnerId,
      name: playerNameById.get(partnerId) ?? partnerId,
      ...pb,
    }))
    .sort((a, b) => b.played - a.played);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header card */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-bold">{player.display_name}</h1>
              {player.level_id && (() => {
                const label = levels.find((l) => l.id === player.level_id)?.label;
                return label ? (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    ระดับ:{" "}
                    <span className="font-medium text-foreground">{label}</span>
                  </p>
                ) : null;
              })()}
            </div>
            {team && (
              <Badge
                variant="outline"
                className="shrink-0 gap-1.5"
                style={
                  team.color
                    ? { borderColor: team.color, color: team.color }
                    : undefined
                }
              >
                {team.color && (
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: team.color }}
                  />
                )}
                {team.name}
              </Badge>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            บทบาท:{" "}
            <span className="font-medium text-foreground">
              {player.role === "captain" ? "กัปตัน" : "สมาชิก"}
            </span>
          </p>
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
        isSideA={(m) => playerPairIds.has(m.pair_a_id ?? "")}
        competitorById={competitorById}
      />

      <HeadToHeadTable
        title="สถิติแยกตามคู่หู"
        nameLabel="คู่หู"
        rows={partnerRows}
        entityType="player"
      />

      <HeadToHeadTable
        title="พบกัน (Head-to-Head)"
        rows={h2hRows}
        entityType="pair"
      />
    </div>
  );
}
