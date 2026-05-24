"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { divisionLabelTh, divisionTone } from "@/lib/tournament/divisions";
import { gameWinner, sumGameScores, computeStandings } from "@/lib/tournament/scoring";
import type { EntityStats } from "@/lib/tournament/entity-stats";
import type { PairWithPlayers, Match } from "@/lib/types";
import type { CompetitorEntry } from "./shared/match-history-list";

function RecentMatchRow({
  match,
  competitorById,
}: {
  match: Match;
  competitorById: Map<string, CompetitorEntry>;
}) {
  const sideA = match.pair_a_id ? competitorById.get(match.pair_a_id) : undefined;
  const sideB = match.pair_b_id ? competitorById.get(match.pair_b_id) : undefined;
  const rawWinner = gameWinner(match.games);
  const totals = sumGameScores(match.games);

  const gamesScore = match.games.map((g) => `${g.a}-${g.b}`).join(", ");

  const winnerLabel =
    rawWinner === "draw"
      ? "เสมอ"
      : rawWinner === "a"
      ? sideA?.name ?? "A"
      : sideB?.name ?? "B";

  return (
    <div className="grid grid-cols-[2rem_1fr_auto_1fr] sm:grid-cols-[2rem_1fr_auto_1fr_auto] items-center gap-x-2 px-4 py-2.5 border-b last:border-b-0 text-sm">
      <span className="text-muted-foreground text-xs tabular-nums">#{match.match_number}</span>
      <span
        className={`truncate min-w-0 ${rawWinner === "a" ? "font-semibold" : "text-muted-foreground"}`}
      >
        {sideA?.name ?? "—"}
      </span>
      <span className="tabular-nums text-center font-medium px-1">
        {totals.a}–{totals.b}
      </span>
      <span
        className={`truncate min-w-0 text-right ${rawWinner === "b" ? "font-semibold" : "text-muted-foreground"}`}
      >
        {sideB?.name ?? "—"}
      </span>
      <span className="text-xs text-muted-foreground hidden sm:block text-right">{gamesScore}</span>
    </div>
  );
}

export function DivisionStatsView({
  stats,
  division,
  divisionPairs,
  competitorById,
}: {
  stats: EntityStats;
  division: number;
  divisionPairs: PairWithPlayers[];
  competitorById: Map<string, CompetitorEntry>;
}) {
  const tone = divisionTone(division);
  const label = divisionLabelTh(division);

  // Pair IDs in this division
  const divisionPairIds = divisionPairs.map((p) => p.id);

  // Standings within division using computeStandings
  const standings =
    divisionPairIds.length > 0
      ? computeStandings(stats.matches, "pair", divisionPairIds).sort(
          (a, b) =>
            b.leaguePoints - a.leaguePoints ||
            b.pointDiff - a.pointDiff ||
            b.pointsFor - a.pointsFor
        )
      : [];

  // Recent matches — last 6 in reverse chronological order
  const recentMatches = [...stats.matches].reverse().slice(0, 6);

  // Summary stats
  const completedPairIds = new Set<string>();
  for (const m of stats.matches) {
    if (m.pair_a_id) completedPairIds.add(m.pair_a_id);
    if (m.pair_b_id) completedPairIds.add(m.pair_b_id);
  }

  const avgPoints =
    stats.played > 0
      ? Math.round((stats.pointsFor + stats.pointsAgainst) / stats.played)
      : 0;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header card */}
      <Card className={`border-2 ${tone.border}`}>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-bold">{label}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {divisionPairs.length} คู่ · {stats.played} แมตช์ที่เสร็จสิ้น
              </p>
            </div>
            <Badge
              variant="outline"
              className={`${tone.border} ${tone.bg} ${tone.text} shrink-0`}
            >
              {label}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* 4-stat grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              แมตช์ทั้งหมด
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-3xl font-bold tabular-nums">{stats.played}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              คู่ที่ลงเล่น
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-3xl font-bold tabular-nums">{completedPairIds.size}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              คู่ทั้งหมด
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-3xl font-bold tabular-nums">{divisionPairs.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              เฉลี่ยคะแนน/แมตช์
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-3xl font-bold tabular-nums">{avgPoints}</p>
          </CardContent>
        </Card>
      </div>

      {/* Pair standings within division */}
      {standings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ตารางคะแนนภายใน {label}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-[1.5rem_1fr_3rem_3rem_3rem_3rem_3rem] gap-x-2 px-4 py-2 border-b bg-muted/40 text-xs text-muted-foreground font-medium">
              <span>#</span>
              <span>คู่</span>
              <span className="text-right">P</span>
              <span className="text-right">W</span>
              <span className="text-right">L</span>
              <span className="text-right">D</span>
              <span className="text-right">Pts</span>
            </div>
            {standings.map((row, idx) => {
              const pairName =
                competitorById.get(row.competitorId)?.name ?? row.competitorId;
              return (
                <div
                  key={row.competitorId}
                  className="grid grid-cols-[1.5rem_1fr_3rem_3rem_3rem_3rem_3rem] gap-x-2 px-4 py-2.5 border-b last:border-b-0 text-sm items-center"
                >
                  <span className="text-muted-foreground text-xs tabular-nums">{idx + 1}</span>
                  <span className="truncate min-w-0">{pairName}</span>
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
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Recent matches */}
      {recentMatches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">แมตช์ล่าสุด</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-[2rem_1fr_auto_1fr] sm:grid-cols-[2rem_1fr_auto_1fr_auto] gap-x-2 px-4 py-2 border-b bg-muted/40 text-xs text-muted-foreground font-medium">
              <span>#</span>
              <span>คู่ A</span>
              <span className="text-center px-1">คะแนน</span>
              <span className="text-right">คู่ B</span>
              <span className="hidden sm:block text-right">เกม</span>
            </div>
            {recentMatches.map((m) => (
              <RecentMatchRow key={m.id} match={m} competitorById={competitorById} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {stats.played === 0 && (
        <Card>
          <CardContent className="pt-6 pb-6">
            <p className="text-sm text-muted-foreground text-center">
              ยังไม่มีแมตช์ที่เสร็จสิ้นใน {label}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
