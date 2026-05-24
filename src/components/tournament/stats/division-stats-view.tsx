"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { divisionLabelTh, divisionTone } from "@/lib/tournament/divisions";
import { gameWinner, computeStandings } from "@/lib/tournament/scoring";
import type { DivisionStats } from "@/lib/tournament/entity-stats";
import type { PairWithPlayers, Match, Team } from "@/lib/types";
import { EntityLink } from "@/components/tournament/stats/entity-link";
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

  const gamesScore = match.games.map((g) => `${g.a}-${g.b}`).join(", ");

  return (
    <div className="grid grid-cols-[2rem_1fr_auto_1fr] items-center gap-x-2 px-4 py-2.5 border-b last:border-b-0 text-sm">
      <span className="text-muted-foreground text-xs tabular-nums">#{match.match_number}</span>
      <span
        className={`truncate min-w-0 ${rawWinner === "a" ? "font-semibold" : "text-muted-foreground"}`}
      >
        {sideA && match.pair_a_id ? (
          <EntityLink entityType="pair" entityId={match.pair_a_id}>
            {sideA.name}
          </EntityLink>
        ) : (
          "—"
        )}
      </span>
      <span className="tabular-nums text-center text-xs text-muted-foreground px-1">
        {gamesScore || "—"}
      </span>
      <span
        className={`truncate min-w-0 text-right ${rawWinner === "b" ? "font-semibold" : "text-muted-foreground"}`}
      >
        {sideB && match.pair_b_id ? (
          <EntityLink entityType="pair" entityId={match.pair_b_id}>
            {sideB.name}
          </EntityLink>
        ) : (
          "—"
        )}
      </span>
    </div>
  );
}

export function DivisionStatsView({
  stats,
  division,
  divisionPairs,
  competitorById,
  teamById,
}: {
  stats: DivisionStats;
  division: number;
  divisionPairs: PairWithPlayers[];
  competitorById: Map<string, CompetitorEntry>;
  teamById?: Map<string, Team>;
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

  // Team breakdown: aggregate the standings rows by pair.team_id so the
  // page shows which teams contributed to this division and how they scored.
  const pairTeamById = new Map(divisionPairs.map((p) => [p.id, p.team_id]));
  type TeamRow = {
    teamId: string;
    name: string;
    color: string | null;
    pairs: number;
    played: number;
    wins: number;
    losses: number;
    draws: number;
    leaguePoints: number;
    pointDiff: number;
  };
  const teamMap = new Map<string, TeamRow>();
  for (const row of standings) {
    const tId = pairTeamById.get(row.competitorId);
    if (!tId) continue;
    const t = teamById?.get(tId);
    const ex = teamMap.get(tId) ?? {
      teamId: tId,
      name: t?.name ?? tId,
      color: t?.color ?? null,
      pairs: 0,
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      leaguePoints: 0,
      pointDiff: 0,
    };
    ex.pairs += 1;
    ex.played += row.played;
    ex.wins += row.wins;
    ex.losses += row.losses;
    ex.draws += row.draws;
    ex.leaguePoints += row.leaguePoints;
    ex.pointDiff += row.pointDiff;
    teamMap.set(tId, ex);
  }
  const teamRows = [...teamMap.values()].sort(
    (a, b) => b.leaguePoints - a.leaguePoints || b.pointDiff - a.pointDiff
  );

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
        <CardContent className="space-y-3">
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

      {/* Team breakdown within division */}
      {teamRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ผลงานแยกทีมใน {label}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-[1.5rem_1fr_2.5rem_2.5rem_2.5rem_2.5rem_2.5rem_3rem] gap-x-2 px-4 py-2 border-b bg-muted/40 text-xs text-muted-foreground font-medium">
              <span>#</span>
              <span>ทีม</span>
              <span className="text-right">คู่</span>
              <span className="text-right">แมตช์</span>
              <span className="text-right">ชนะ</span>
              <span className="text-right">แพ้</span>
              <span className="text-right">เสมอ</span>
              <span className="text-right">Pts</span>
            </div>
            {teamRows.map((row, idx) => (
              <div
                key={row.teamId}
                className="grid grid-cols-[1.5rem_1fr_2.5rem_2.5rem_2.5rem_2.5rem_2.5rem_3rem] gap-x-2 px-4 py-2.5 border-b last:border-b-0 text-sm items-center"
              >
                <span className="text-muted-foreground text-xs tabular-nums">{idx + 1}</span>
                <span className="truncate min-w-0 flex items-center gap-1.5">
                  {row.color && (
                    <span
                      className="inline-block w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: row.color }}
                    />
                  )}
                  <EntityLink entityType="team" entityId={row.teamId}>{row.name}</EntityLink>
                </span>
                <span className="text-right tabular-nums text-muted-foreground">{row.pairs}</span>
                <span className="text-right tabular-nums">{row.played}</span>
                <span className="text-right tabular-nums text-green-600 dark:text-green-400">{row.wins}</span>
                <span className="text-right tabular-nums text-red-600 dark:text-red-400">{row.losses}</span>
                <span className="text-right tabular-nums text-yellow-600 dark:text-yellow-400">{row.draws}</span>
                <span className="text-right tabular-nums font-semibold">{row.leaguePoints}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

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
                  <span className="truncate min-w-0">
                    <EntityLink entityType="pair" entityId={row.competitorId}>
                      {pairName}
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
            <div className="grid grid-cols-[2rem_1fr_auto_1fr] gap-x-2 px-4 py-2 border-b bg-muted/40 text-xs text-muted-foreground font-medium">
              <span>#</span>
              <span>คู่ A</span>
              <span className="text-center px-1">เกม</span>
              <span className="text-right">คู่ B</span>
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
