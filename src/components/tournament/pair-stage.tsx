"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PairManager } from "@/components/tournament/pair-manager";
import { MatchRow } from "@/components/tournament/match-row";
import { StandingsTable } from "@/components/tournament/standings-table";
import { generatePairMatchesAction } from "@/lib/actions/matches";
import { buildCompetitorMap, pairToCompetitor, teamToCompetitor } from "@/lib/tournament/competitor";
import { computeStandings } from "@/lib/tournament/scoring";
import { CsvImportDialog } from "@/components/tournament/csv-import-dialog";
import { ManualMatchDialog } from "@/components/tournament/manual-match-dialog";
import type { TeamWithPlayers, PairWithPlayers, Match, Team } from "@/lib/types";

export function PairStage({
  tournamentId,
  teams,
  pairs,
  matches,
  isOwner,
  pairDivisionThreshold = null,
  matchRowSize,
}: {
  tournamentId: string;
  teams: TeamWithPlayers[];
  pairs: PairWithPlayers[];
  matches: Match[];
  isOwner: boolean;
  pairDivisionThreshold?: number | null;
  matchRowSize?: "compact" | "comfortable";
}) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [, startGen] = useTransition();

  const flatTeams: Team[] = teams.map(({ players: _p, ...t }) => t as Team);
  const teamById = new Map(flatTeams.map((t) => [t.id, t]));

  const pairCompetitorMap = buildCompetitorMap("pair", flatTeams, pairs);
  const pairCompetitors = Array.from(pairCompetitorMap.values());
  const teamCompetitors = flatTeams.map(teamToCompetitor);

  const pairsByTeam = new Map<string, PairWithPlayers[]>();
  for (const p of pairs) {
    if (!pairsByTeam.has(p.team_id)) pairsByTeam.set(p.team_id, []);
    pairsByTeam.get(p.team_id)!.push(p);
  }

  // Aggregate team-level standings from pair matches
  const pairStandings = computeStandings(matches, "pair", pairs.map((p) => p.id));
  const teamAgg = new Map<string, { wins: number; draws: number; losses: number; pf: number; pa: number }>();
  for (const ps of pairStandings) {
    const pair = pairs.find((p) => p.id === ps.competitorId);
    if (!pair) continue;
    const cur = teamAgg.get(pair.team_id) || { wins: 0, draws: 0, losses: 0, pf: 0, pa: 0 };
    cur.wins += ps.wins; cur.draws += ps.draws; cur.losses += ps.losses;
    cur.pf += ps.pointsFor; cur.pa += ps.pointsAgainst;
    teamAgg.set(pair.team_id, cur);
  }

  const upperMatches = matches.filter((m) => m.division === "upper");
  const lowerMatches = matches.filter((m) => m.division === "lower");
  const undividedMatches = matches.filter((m) => !m.division);

  const totalMatches = matches.length;
  const completedMatches = matches.filter((m) => m.status === "completed").length;
  const hasMatches = totalMatches > 0;
  const totalPairs = pairs.length;
  const teamsWithPairs = pairsByTeam.size;

  const showStandings = hasMatches && completedMatches > 0;

  return (
    <Tabs defaultValue="pairs" className="space-y-4">
      <TabsList className="w-full flex-wrap h-auto">
        <TabsTrigger value="pairs">คู่</TabsTrigger>
        <TabsTrigger value="matches">แข่งขัน</TabsTrigger>
        <TabsTrigger value="standings" disabled={!showStandings}>คะแนนกลุ่ม</TabsTrigger>
      </TabsList>

      {/* Pair manager per team */}
      <TabsContent value="pairs" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">จับคู่ภายในทีม</h2>
          {isOwner && <CsvImportDialog tournamentId={tournamentId} onlyMode="pairs" />}
        </div>
        {teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">เพิ่มทีมก่อนจัดคู่</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {teams.map((t) => (
              <PairManager
                key={t.id}
                team={t}
                pairs={pairsByTeam.get(t.id) ?? []}
                isOwner={isOwner}
              />
            ))}
          </div>
        )}
      </TabsContent>

      {/* Generate matches */}
      <TabsContent value="matches" className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">การแข่งขัน</h2>
            {hasMatches && <Badge variant="outline" className="text-xs">{completedMatches}/{totalMatches} แมตช์</Badge>}
          </div>
          {isOwner && (
            <div className="flex items-center gap-2">
              {hasMatches && (
                <ManualMatchDialog
                  tournamentId={tournamentId}
                  pairs={pairs}
                  pairDivisionThreshold={pairDivisionThreshold}
                />
              )}
              {totalPairs >= 2 && teamsWithPairs >= 2 && (
                <Button size="sm" variant={hasMatches ? "outline" : "default"}
                  onClick={() => startGen(async () => {
                    const res = await generatePairMatchesAction(tournamentId);
                    if ("error" in res) toast.error(res.error);
                    else {
                      const parts = [];
                      if (res.upper) parts.push(`กลุ่มบน ${res.upper}`);
                      if (res.lower) parts.push(`กลุ่มล่าง ${res.lower}`);
                      toast.success(`สร้าง ${res.count} แมตช์ (${parts.join(", ")})`);
                    }
                  })}>
                  <Swords className="h-3.5 w-3.5 mr-1" />
                  {hasMatches ? "สร้างใหม่" : "สร้างตารางแข่ง"}
                </Button>
              )}
            </div>
          )}
        </div>

        {!hasMatches && teamsWithPairs < 2 && (
          <p className="text-sm text-muted-foreground">ต้องมีอย่างน้อย 2 ทีมที่มีคู่</p>
        )}

        {hasMatches && (() => {
          const hasDivisions = upperMatches.length > 0 || lowerMatches.length > 0;
          const displayGroups: { label: string; matchList: typeof matches }[] = hasDivisions
            ? [
                ...(upperMatches.length > 0 ? [{ label: "กลุ่มบน", matchList: upperMatches }] : []),
                ...(lowerMatches.length > 0 ? [{ label: "กลุ่มล่าง", matchList: lowerMatches }] : []),
              ]
            : [{ label: "แมตช์ทั้งหมด", matchList: undividedMatches.length > 0 ? undividedMatches : matches }];

          return (
            <div className="space-y-3">
              {displayGroups.map(({ label, matchList }) => {
                const isOpen = openGroups[label] !== false;
                return (
                <Card key={label}>
                  <CardContent className="pt-4 space-y-2">
                    <button
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setOpenGroups(prev => ({ ...prev, [label]: !isOpen }))}>
                      {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {label}
                      <span className="ml-1">({matchList.filter(m => m.status === "completed").length}/{matchList.length})</span>
                    </button>
                    {isOpen && (
                      <div className="divide-y">
                        {matchList.map((m) => (
                          <MatchRow
                            key={m.id} match={m}
                            competitorById={pairCompetitorMap}
                            tournamentId={tournamentId}
                            isOwner={isOwner}
                            unit="pair"
                            size={matchRowSize}
                          />
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
                );
              })}
            </div>
          );
        })()}
      </TabsContent>

      {/* Standings */}
      <TabsContent value="standings" className="space-y-3">
        {!showStandings ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีผลการแข่งขัน</p>
        ) : (() => {
          const hasDivisions = upperMatches.length > 0 || lowerMatches.length > 0;

          function divisionStandings(divMatches: typeof matches) {
            const pairIds = [...new Set([
              ...divMatches.map(m => m.pair_a_id),
              ...divMatches.map(m => m.pair_b_id),
            ].filter(Boolean) as string[])];
            const divCompetitors = pairIds.map(id => pairCompetitorMap.get(id)).filter(Boolean) as typeof pairCompetitors;
            return { divCompetitors, pairIds };
          }

          return (
            <>
              <h2 className="font-semibold">อันดับ</h2>
              {hasDivisions ? (
                <div className="space-y-4">
                  {upperMatches.length > 0 && (() => {
                    const { divCompetitors } = divisionStandings(upperMatches);
                    return (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">กลุ่มบน</p>
                        <Card>
                          <CardContent className="pt-3">
                            <StandingsTable matches={upperMatches} competitors={divCompetitors} unit="pair" />
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })()}
                  {lowerMatches.length > 0 && (() => {
                    const { divCompetitors } = divisionStandings(lowerMatches);
                    return (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">กลุ่มล่าง</p>
                        <Card>
                          <CardContent className="pt-3">
                            <StandingsTable matches={lowerMatches} competitors={divCompetitors} unit="pair" />
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">รวมทีม</CardTitle></CardHeader>
                    <CardContent>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground border-b">
                            <th className="text-left pb-1 font-normal">ทีม</th>
                            <th className="text-center pb-1 font-normal w-7">W</th>
                            <th className="text-center pb-1 font-normal w-7">D</th>
                            <th className="text-center pb-1 font-normal w-7">L</th>
                            <th className="text-center pb-1 font-normal w-10">+/-</th>
                            <th className="text-center pb-1 font-normal w-8">Pts</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...teamAgg.entries()]
                            .map(([teamId, s]) => ({ teamId, ...s, pts: s.wins * 3 + s.draws, diff: s.pf - s.pa }))
                            .sort((a, b) => b.pts - a.pts || b.diff - a.diff || b.pf - a.pf)
                            .map((row, i) => {
                              const t = teamById.get(row.teamId);
                              return (
                                <tr key={row.teamId} className={i === 0 ? "font-semibold" : ""}>
                                  <td className="py-0.5">
                                    <div className="flex items-center gap-1.5">
                                      {t?.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />}
                                      <span>{t?.name ?? "—"}</span>
                                    </div>
                                  </td>
                                  <td className="text-center tabular-nums">{row.wins}</td>
                                  <td className="text-center tabular-nums">{row.draws}</td>
                                  <td className="text-center tabular-nums">{row.losses}</td>
                                  <td className="text-center tabular-nums">{row.diff > 0 ? "+" : ""}{row.diff}</td>
                                  <td className="text-center font-semibold tabular-nums">{row.pts}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">รายคู่</CardTitle></CardHeader>
                    <CardContent>
                      <StandingsTable matches={matches} competitors={pairCompetitors} unit="pair" />
                    </CardContent>
                  </Card>
                </div>
              )}
            </>
          );
        })()}
      </TabsContent>
    </Tabs>
  );
}
