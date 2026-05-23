"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";
import type { EntityStats } from "@/lib/tournament/entity-stats";
import type { Team, PairWithPlayers, Match } from "@/lib/types";

type CompetitorEntry = { id: string; name: string; color?: string | null };

function formatWinRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function StreakPill({
  streak,
}: {
  streak: { type: "W" | "L" | "D" | null; length: number };
}) {
  if (!streak.type || streak.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const colorMap: Record<"W" | "L" | "D", string> = {
    W: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    L: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    D: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  };
  const labelMap: Record<"W" | "L" | "D", string> = { W: "ชนะ", L: "แพ้", D: "เสมอ" };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm font-semibold ${colorMap[streak.type]}`}
    >
      {labelMap[streak.type]} {streak.length} ติด
    </span>
  );
}

function PairMatchRow({
  match,
  teamPairIds,
  competitorById,
}: {
  match: Match;
  teamPairIds: Set<string>;
  competitorById: Map<string, CompetitorEntry>;
}) {
  const isSideA = teamPairIds.has(match.pair_a_id ?? "");
  const myPairId = isSideA ? match.pair_a_id : match.pair_b_id;
  const opponentId = isSideA ? match.pair_b_id : match.pair_a_id;
  const myPair = myPairId ? competitorById.get(myPairId) : undefined;
  const opponent = opponentId ? competitorById.get(opponentId) : undefined;
  const rawWinner = gameWinner(match.games);
  const totals = sumGameScores(match.games);

  let result: "W" | "L" | "D";
  if (rawWinner === "draw") result = "D";
  else if ((rawWinner === "a" && isSideA) || (rawWinner === "b" && !isSideA)) result = "W";
  else result = "L";

  const myPoints = isSideA ? totals.a : totals.b;
  const oppPoints = isSideA ? totals.b : totals.a;

  const resultColor = {
    W: "text-green-600 dark:text-green-400 font-semibold",
    L: "text-red-600 dark:text-red-400 font-semibold",
    D: "text-yellow-600 dark:text-yellow-400 font-semibold",
  }[result];

  const resultLabel = { W: "ชนะ", L: "แพ้", D: "เสมอ" }[result];

  const gamesScore = match.games
    .map((g) => (isSideA ? `${g.a}-${g.b}` : `${g.b}-${g.a}`))
    .join(", ");

  return (
    <div className="grid grid-cols-[2rem_1fr_1fr_3rem_4rem] sm:grid-cols-[2rem_1fr_1fr_3rem_4rem_auto] items-center gap-x-2 px-4 py-2.5 border-b last:border-b-0 text-sm">
      <span className="text-muted-foreground text-xs tabular-nums">#{match.match_number}</span>
      <span className="truncate min-w-0 text-xs text-muted-foreground">
        {myPair?.name ?? "—"}
      </span>
      <span className="truncate min-w-0">{opponent?.name ?? <span className="text-muted-foreground">—</span>}</span>
      <span className={resultColor}>{resultLabel}</span>
      <span className="tabular-nums text-right font-medium">{myPoints}–{oppPoints}</span>
      <span className="text-xs text-muted-foreground hidden sm:block">{gamesScore}</span>
    </div>
  );
}

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

  const wlLabel =
    stats.played > 0
      ? `${stats.wins}W${stats.draws > 0 ? ` ${stats.draws}D` : ""} ${stats.losses}L`
      : "—";

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
  const h2hRows = Array.from(stats.headToHead.entries())
    .map(([opponentTeamId, h2h]) => ({
      opponentTeamId,
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

      {/* 4-stat grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              แมตช์
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-3xl font-bold tabular-nums">{stats.played}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              ผลงาน
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xl font-bold tabular-nums">{wlLabel}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              อัตราชนะ
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-3xl font-bold tabular-nums">{formatWinRate(stats.winRate)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              ต่างคะแนน
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p
              className={`text-3xl font-bold tabular-nums ${
                stats.pointsDiff > 0
                  ? "text-green-600 dark:text-green-400"
                  : stats.pointsDiff < 0
                  ? "text-red-600 dark:text-red-400"
                  : ""
              }`}
            >
              {stats.pointsDiff > 0 ? "+" : ""}
              {stats.pointsDiff}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Streak pill */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">สถิติต่อเนื่อง:</span>
        <StreakPill streak={stats.streak} />
      </div>

      {/* Per-pair breakdown */}
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

      {/* Match history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ประวัติแมตช์</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {stats.matches.length === 0 ? (
            <p className="text-sm text-muted-foreground px-6 pb-6">
              ยังไม่มีแมตช์ที่เสร็จสิ้น
            </p>
          ) : (
            <div>
              <div className="grid grid-cols-[2rem_1fr_1fr_3rem_4rem] sm:grid-cols-[2rem_1fr_1fr_3rem_4rem_auto] gap-x-2 px-4 py-2 border-b bg-muted/40 text-xs text-muted-foreground font-medium">
                <span>#</span>
                <span>คู่ (ทีม)</span>
                <span>คู่แข่ง</span>
                <span>ผล</span>
                <span className="text-right">คะแนน</span>
                <span className="hidden sm:block">เกม</span>
              </div>
              {stats.matches.map((m) => (
                <PairMatchRow
                  key={m.id}
                  match={m}
                  teamPairIds={teamPairIds}
                  competitorById={competitorById}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* H2H vs opponent teams */}
      {h2hRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">พบกัน (Head-to-Head) ต่อทีม</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-[1fr_3rem_3rem_3rem_3rem] gap-x-2 px-4 py-2 border-b bg-muted/40 text-xs text-muted-foreground font-medium">
              <span>ทีมคู่แข่ง</span>
              <span className="text-right">แมตช์</span>
              <span className="text-right">ชนะ</span>
              <span className="text-right">แพ้</span>
              <span className="text-right">เสมอ</span>
            </div>
            {h2hRows.map((row) => (
              <div
                key={row.opponentTeamId}
                className="grid grid-cols-[1fr_3rem_3rem_3rem_3rem] gap-x-2 px-4 py-2.5 border-b last:border-b-0 text-sm items-center"
              >
                <span className="flex items-center gap-1.5 truncate min-w-0">
                  {row.color && (
                    <span
                      className="inline-block w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: row.color }}
                    />
                  )}
                  {row.name}
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
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
