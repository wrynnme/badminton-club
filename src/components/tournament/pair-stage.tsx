"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PairManager } from "@/components/tournament/pair-manager";
import { MatchRow } from "@/components/tournament/match-row";
import { StandingsTable } from "@/components/tournament/standings-table";
import { generatePairMatchesAction } from "@/lib/actions/matches";
import { buildCompetitorMap, pairToCompetitor, teamToCompetitor } from "@/lib/tournament/competitor";
import { computeStandings } from "@/lib/tournament/scoring";
import { CsvImportDialog } from "@/components/tournament/csv-import-dialog";
import type { TeamWithPlayers, PairWithPlayers, Match, Team } from "@/lib/types";

export function PairStage({
  tournamentId,
  teams,
  pairs,
  matches,
  isOwner,
}: {
  tournamentId: string;
  teams: TeamWithPlayers[];
  pairs: PairWithPlayers[];
  matches: Match[];
  isOwner: boolean;
}) {
  const [showMatches, setShowMatches] = useState(true);
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

  const totalMatches = matches.length;
  const completedMatches = matches.filter((m) => m.status === "completed").length;
  const hasMatches = totalMatches > 0;
  const totalPairs = pairs.length;
  const teamsWithPairs = pairsByTeam.size;

  return (
    <div className="space-y-6">
      {/* Pair manager per team */}
      <section className="space-y-3">
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
      </section>

      <Separator />

      {/* Generate matches */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">การแข่งขัน</h2>
            {hasMatches && <Badge variant="outline" className="text-xs">{completedMatches}/{totalMatches} แมตช์</Badge>}
          </div>
          {isOwner && totalPairs >= 2 && teamsWithPairs >= 2 && (
            <Button size="sm" variant={hasMatches ? "outline" : "default"}
              onClick={() => startGen(async () => {
                const res = await generatePairMatchesAction(tournamentId);
                if (res?.error) toast.error(res.error);
                else toast.success(`สร้าง ${res.count} แมตช์แล้ว`);
              })}>
              <Swords className="h-3.5 w-3.5 mr-1" />
              {hasMatches ? "สร้างใหม่" : "สร้างตารางแข่ง"}
            </Button>
          )}
        </div>

        {!hasMatches && teamsWithPairs < 2 && (
          <p className="text-sm text-muted-foreground">ต้องมีอย่างน้อย 2 ทีมที่มีคู่</p>
        )}

        {hasMatches && (
          <Card>
            <CardContent className="pt-4 space-y-2">
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowMatches(!showMatches)}>
                {showMatches ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                แมตช์ทั้งหมด
              </button>
              {showMatches && (
                <div className="divide-y">
                  {matches.map((m) => (
                    <MatchRow
                      key={m.id} match={m}
                      competitorById={pairCompetitorMap}
                      tournamentId={tournamentId}
                      isOwner={isOwner}
                      unit="pair"
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </section>

      {/* Standings */}
      {hasMatches && completedMatches > 0 && (
        <>
          <Separator />
          <section className="space-y-3">
            <h2 className="font-semibold">อันดับ</h2>
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
                        .map(([teamId, s]) => ({
                          teamId, ...s,
                          pts: s.wins * 3 + s.draws * 1,
                          diff: s.pf - s.pa,
                        }))
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
          </section>
        </>
      )}
    </div>
  );
}
