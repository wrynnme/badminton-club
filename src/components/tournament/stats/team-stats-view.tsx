"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { gameWinner } from "@/lib/tournament/scoring";
import type { TeamStats } from "@/lib/tournament/entity-stats";
import type { Team, PairWithPlayers } from "@/lib/types";
import { computePairDivision, parsePairLevel, divisionTone } from "@/lib/tournament/divisions";
import { EntityLink } from "@/components/tournament/stats/entity-link";
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
  thresholds = [],
}: {
  stats: TeamStats;
  team: Team;
  teamPairs: PairWithPlayers[];
  competitorById: Map<string, CompetitorEntry>;
  teamById: Map<string, Team>;
  thresholds?: number[];
}) {
  const t = useTranslations("stats");
  const tDiv = useTranslations("tournament");

  const hasDivisions = thresholds.length > 0;
  // Map pairId -> division number (1..N) or null when unknown / no split
  const divisionByPairId = new Map<string, number | null>(
    teamPairs.map((p) => [
      p.id,
      hasDivisions ? computePairDivision(parsePairLevel(p.pair_level), thresholds) : null,
    ])
  );
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
    (a, b) =>
      b.leaguePoints - a.leaguePoints ||
      b.wins - a.wins ||
      b.played - a.played
  );

  // H2H vs opponent teams
  const h2hRows: HeadToHeadRow[] = Object.entries(stats.headToHead)
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
        <CardContent className="space-y-3">
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
                {t("teamView.pairCount", { count: teamPairs.length })}
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
        <span className="text-sm text-muted-foreground">{t("shared.streakLabel")}</span>
        <StreakPill streak={stats.streak} />
      </div>

      {/* Per-pair breakdown — has extra Pts column, can't use HeadToHeadTable */}
      {pairRows.length > 0 && (() => {
        // Group rows by division. Each group keeps the original sort
        // (leaguePoints desc) so rank inside the group reflects relative
        // standing among teammates in that division.
        const groups = new Map<number | null, typeof pairRows>();
        for (const row of pairRows) {
          const divKey = divisionByPairId.get(row.pairId) ?? null;
          const arr = groups.get(divKey) ?? [];
          arr.push(row);
          groups.set(divKey, arr);
        }
        const divKeysSorted = [...groups.keys()].sort((a, b) => {
          if (a === null) return 1;
          if (b === null) return -1;
          return a - b;
        });
        const renderTable = (rows: typeof pairRows) => (
          <CardContent className="p-0">
            <div className="grid grid-cols-[2rem_1fr_3rem_3rem_3rem_3rem_3rem] gap-x-2 px-4 py-2 border-b bg-muted/40 text-xs text-muted-foreground font-medium">
              <span>#</span>
              <span>{t("teamView.colPair")}</span>
              <span className="text-right">{t("teamView.colMatches")}</span>
              <span className="text-right">{t("teamView.colWins")}</span>
              <span className="text-right">{t("teamView.colLosses")}</span>
              <span className="text-right">{t("teamView.colDraws")}</span>
              <span className="text-right">Pts</span>
            </div>
            {rows.map((row, idx) => (
              <div
                key={row.pairId}
                className="grid grid-cols-[2rem_1fr_3rem_3rem_3rem_3rem_3rem] gap-x-2 px-4 py-2.5 border-b last:border-b-0 text-sm items-center"
              >
                <span className="text-muted-foreground text-xs tabular-nums">{idx + 1}</span>
                <span className="truncate min-w-0">
                  <EntityLink entityType="pair" entityId={row.pairId}>
                    {row.name}
                  </EntityLink>
                </span>
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
        );

        // No-split fallback: single card, original layout
        if (!hasDivisions || divKeysSorted.length === 1) {
          return (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("teamView.pairBreakdownTitle")}</CardTitle>
              </CardHeader>
              {renderTable(pairRows)}
            </Card>
          );
        }

        // Split by division — one card per group with colored heading
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("teamView.pairBreakdownTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0 space-y-4 pb-4">
              {divKeysSorted.map((divKey) => {
                const rows = groups.get(divKey) ?? [];
                const tone = divKey !== null ? divisionTone(divKey) : null;
                const label = divKey !== null ? tDiv("division", { n: divKey }) : t("teamView.unassignedDivision");
                return (
                  <div key={String(divKey)} className="space-y-1">
                    <p className={`text-xs font-medium px-4 ${tone?.text ?? "text-muted-foreground"}`}>
                      {divKey !== null ? (
                        <EntityLink entityType="division" entityId={String(divKey)}>{label}</EntityLink>
                      ) : (
                        label
                      )}
                    </p>
                    {renderTable(rows)}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })()}

      <MatchHistoryList
        matches={stats.matches}
        isSideA={(m) => teamPairIds.has(m.pair_a_id ?? "")}
        competitorById={competitorById}
        myColumnLabel={t("teamView.myPairColumnLabel")}
        renderMyColumn={(m, isSideA) => {
          const myPairId = isSideA ? m.pair_a_id : m.pair_b_id;
          const myPair = myPairId ? competitorById.get(myPairId) : undefined;
          if (!myPair || !myPairId) return "—";
          return (
            <EntityLink entityType="pair" entityId={myPairId}>
              {myPair.name}
            </EntityLink>
          );
        }}
      />

      <HeadToHeadTable
        title={t("teamView.h2hTitle")}
        nameLabel={t("teamView.h2hNameLabel")}
        rows={h2hRows}
        entityType="team"
      />
    </div>
  );
}
