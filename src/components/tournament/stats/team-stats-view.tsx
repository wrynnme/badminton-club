"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { gameWinner } from "@/lib/tournament/scoring";
import type { EntityStats } from "@/lib/tournament/entity-stats";
import type { Team, PairWithPlayers } from "@/lib/types";
import { StreakPill } from "./shared/streak-pill";
import { StatHeaderCards } from "./shared/stat-header-cards";
import { MatchHistoryList, type CompetitorEntry } from "./shared/match-history-list";
import { HeadToHeadTable, type HeadToHeadRow } from "./shared/head-to-head-table";

export function TeamStatsView({
  stats,
  team,
  teamPairs,
  competitorById,
  teamById,
}: {
  stats: EntityStats;
  team: Team;
  teamPairs: PairWithPlayers[];
  competitorById: Map<string, CompetitorEntry>;
  teamById: Map<string, Team>;
}) {
  // Set of pair IDs that belong to this team
  const teamPairIds = new Set(teamPairs.map((p) => p.id));

  // Per-pair breakdown: aggregate per pair
  type PairRow = {
    pairId: string;
    name: string;
    played: number;
    wins: number;
    losses: number;
    draws: number;
    leaguePoints: number;
  };
  const pairStatsMap = new Map<string, PairRow>();

  for (const m of stats.matches) {
    const isSideA = teamPairIds.has(m.pair_a_id ?? "");
    const activePairId = isSideA ? m.pair_a_id! : m.pair_b_id!;
    if (!teamPairIds.has(activePairId)) continue;

    // Skip intra-team (opponent pair also in team)
    const opponentPairId = isSideA ? m.pair_b_id : m.pair_a_id;
    if (opponentPairId && teamPairIds.has(opponentPairId)) continue;

    const rawWinner = gameWinner(m.games);
    let result: "W" | "L" | "D";
    if (rawWinner === "draw") result = "D";
    else if ((rawWinner === "a" && isSideA) || (rawWinner === "b" && !isSideA)) result = "W";
    else result = "L";

    const existing = pairStatsMap.get(activePairId) ?? {
      pairId: activePairId,
      name: competitorById.get(activePairId)?.name ?? activePairId,
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      leaguePoints: 0,
    };
    existing.played++;
    if (result === "W") { existing.wins++; existing.leaguePoints += 3; }
    else if (result === "L") existing.losses++;
    else { existing.draws++; existing.leaguePoints += 1; }
    pairStatsMap.set(activePairId, existing);
  }

  const pairRows = Array.from(pairStatsMap.values()).sort(
    (a, b) => b.wins - a.wins || b.played - a.played
  );

  // H2H vs opponent teams
  const h2hRows: HeadToHeadRow[] = Array.from(stats.headToHead.entries())
    .map(([opponentTeamId, h2h]) => ({
      id: opponentTeamId,
      name: teamById.get(opponentTeamId)?.name ?? opponentTeamId,
      color: teamById.get(opponentTeamId)?.color ?? null,
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
              <div className="flex items-center gap-2">
                {team.color && (
                  <span
                    className="inline-block w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: team.color }}
                  />
                )}
                <h1 className="text-xl font-bold">{team.name}</h1>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {teamPairs.length} คู่
              </p>
            </div>
            {team.color && (
              <Badge
                variant="outline"
                className="shrink-0 gap-1.5"
                style={{ borderColor: team.color, color: team.color }}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: team.color }}
                />
                {team.name}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <StatHeaderCards stats={stats} />

      {/* Streak pill */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">สถิติต่อเนื่อง:</span>
        <StreakPill streak={stats.streak} />
      </div>

      {/* Per-pair breakdown — has extra Pts column, can't use HeadToHeadTable */}
      {pairRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ผลงานแยกตามคู่</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-[1fr_3rem_3rem_3rem_3rem_3rem] gap-x-2 px-4 py-2 border-b bg-muted/40 text-xs text-muted-foreground font-medium">
              <span>คู่</span>
              <span className="text-right">แมตช์</span>
              <span className="text-right">ชนะ</span>
              <span className="text-right">แพ้</span>
              <span className="text-right">เสมอ</span>
              <span className="text-right">Pts</span>
            </div>
            {pairRows.map((row) => (
              <div
                key={row.pairId}
                className="grid grid-cols-[1fr_3rem_3rem_3rem_3rem_3rem] gap-x-2 px-4 py-2.5 border-b last:border-b-0 text-sm items-center"
              >
                <span className="truncate min-w-0">{row.name}</span>
                <span className="text-right tabular-nums">{row.played}</span>
                <span className="text-right tabular-nums text-green-600 dark:text-green-400">
                  {row.wins}
                </span>
                <span className="text-right tabular-nums text-red-600 dark:text-red-400">
                  {row.losses}
                </span>
                <span className="text-right tabular-nums text-yellow-600 dark:text-yellow-400">
                  {row.draws}
                </span>
                <span className="text-right tabular-nums font-semibold">
                  {row.leaguePoints}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <MatchHistoryList
        matches={stats.matches}
        isSideA={(m) => teamPairIds.has(m.pair_a_id ?? "")}
        competitorById={competitorById}
        myColumnLabel="คู่ (ทีม)"
        renderMyColumn={(m, isSideA) => {
          const myPairId = isSideA ? m.pair_a_id : m.pair_b_id;
          const myPair = myPairId ? competitorById.get(myPairId) : undefined;
          return myPair?.name ?? "—";
        }}
      />

      <HeadToHeadTable
        title="พบกัน (Head-to-Head) ต่อทีม"
        nameLabel="ทีมคู่แข่ง"
        rows={h2hRows}
      />
    </div>
  );
}
