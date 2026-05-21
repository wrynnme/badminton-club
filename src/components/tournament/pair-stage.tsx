"use client";

import { CsvImportDialog } from "@/components/tournament/csv-import-dialog";
import { ManualMatchDialog } from "@/components/tournament/manual-match-dialog";
import { MatchList } from "@/components/tournament/match-list";
import { PairManager } from "@/components/tournament/pair-manager";
import { StandingsTable } from "@/components/tournament/standings-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generatePairMatchesAction } from "@/lib/actions/matches";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { parseDivision, divisionLabelTh, divisionTone } from "@/lib/tournament/divisions";
import { computeStandings, aggregatePairStandingsToTeams } from "@/lib/tournament/scoring";
import type { Match, PairWithPlayers, Team, TeamWithPlayers } from "@/lib/types";
import { ChevronDown, ChevronUp, Loader2, Swords } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

export function PairStage({
  tournamentId,
  teams,
  pairs,
  matches,
  isOwner,
  pairDivisionThresholds = [],
  matchRowSize,
}: {
  tournamentId: string;
  teams: TeamWithPlayers[];
  pairs: PairWithPlayers[];
  matches: Match[];
  isOwner: boolean;
  pairDivisionThresholds?: number[];
  matchRowSize?: "compact" | "comfortable";
}) {
  const [genPending, startGen] = useTransition();

  const flatTeams: Team[] = useMemo(
    () => teams.map(({ players: _p, ...t }) => t as Team),
    [teams],
  );
  const teamById = useMemo(() => new Map(flatTeams.map((t) => [t.id, t])), [flatTeams]);

  const pairCompetitorMap = useMemo(
    () => buildCompetitorMap("pair", flatTeams, pairs),
    [flatTeams, pairs],
  );
  const pairCompetitors = useMemo(() => Array.from(pairCompetitorMap.values()), [pairCompetitorMap]);

  const pairsByTeam = useMemo(() => {
    const map = new Map<string, PairWithPlayers[]>();
    for (const p of pairs) {
      if (!map.has(p.team_id)) map.set(p.team_id, []);
      map.get(p.team_id)!.push(p);
    }
    return map;
  }, [pairs]);

  // Group matches by division (number | null)
  const matchesByDivision = useMemo(() => {
    const map = new Map<number | null, Match[]>();
    for (const m of matches) {
      const key = parseDivision(m.division);
      const arr = map.get(key) ?? [];
      arr.push(m);
      map.set(key, arr);
    }
    return map;
  }, [matches]);

  // Sorted division keys: numeric divisions first (1, 2, … N), then null last
  const divisionKeys = useMemo(
    () =>
      Array.from(matchesByDivision.keys()).sort(
        (a, b) => (a ?? 99) - (b ?? 99),
      ),
    [matchesByDivision],
  );

  // Aggregate team-level standings from pair matches
  const pairStandings = useMemo(
    () => computeStandings(matches, "pair", pairs.map((p) => p.id)),
    [matches, pairs],
  );
  const teamAggRows = useMemo(
    () => aggregatePairStandingsToTeams(pairStandings, pairs, flatTeams),
    [pairStandings, pairs, flatTeams],
  );

  // openSet tracks divisions explicitly toggled; first key opens by default when nothing toggled
  const [openSet, setOpenSet] = useState<Set<string>>(() => new Set());
  const isOpen = (k: number | null) => {
    const s = String(k);
    if (openSet.has(s)) return true;
    // first key open by default if user hasn't toggled anything
    return openSet.size === 0 && divisionKeys.length > 0 && String(divisionKeys[0]) === s;
  };
  const toggle = (k: number | null) => setOpenSet((prev) => {
    const next = new Set(prev);
    const s = String(k);
    // Seed with default-open if user is interacting for the first time
    if (next.size === 0 && divisionKeys.length > 0) {
      next.add(String(divisionKeys[0]));
    }
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  });

  const totalMatches = matches.length;
  const completedMatches = matches.filter((m) => m.status === "completed").length;
  const hasMatches = totalMatches > 0;
  const totalPairs = pairs.length;
  const teamsWithPairs = pairsByTeam.size;

  const showStandings = hasMatches && completedMatches > 0;
  const hasDivisions = divisionKeys.some((k) => k !== null);

  function getDivisionCompetitors(divMatches: Match[]) {
    const pairIds = [...new Set([
      ...divMatches.map((m) => m.pair_a_id),
      ...divMatches.map((m) => m.pair_b_id),
    ].filter(Boolean) as string[])];
    return pairIds.map((id) => pairCompetitorMap.get(id)).filter(Boolean) as typeof pairCompetitors;
  }

  return (
    <Tabs defaultValue="pairs" className="space-y-4">
      <TabsList className="w-full flex-wrap h-auto">
        <TabsTrigger value="pairs">จับคู่</TabsTrigger>
        <TabsTrigger value="matches">แข่งขัน</TabsTrigger>
        <TabsTrigger value="standings" disabled={!showStandings}>คะแนน</TabsTrigger>
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
                  pairDivisionThresholds={pairDivisionThresholds}
                />
              )}
              {totalPairs >= 2 && teamsWithPairs >= 2 && (
                <Button size="sm" variant={hasMatches ? "outline" : "default"}
                  disabled={genPending}
                  onClick={() => startGen(async () => {
                    const res = await generatePairMatchesAction(tournamentId);
                    if ("error" in res) toast.error(res.error);
                    else {
                      const koNote = res.knockoutCleared ? " — รีเซ็ตสาย knockout" : "";
                      toast.success(`สร้าง ${res.count} แมตช์${koNote}`);
                    }
                  })}>
                  {genPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Swords className="h-3.5 w-3.5 mr-1" />}
                  {hasMatches ? "สร้างใหม่" : "สร้างตารางแข่ง"}
                </Button>
              )}
            </div>
          )}
        </div>

        {!hasMatches && teamsWithPairs < 2 && (
          <p className="text-sm text-muted-foreground">ต้องมีอย่างน้อย 2 ทีมที่มีคู่</p>
        )}

        {hasMatches && (
          <div className="space-y-3">
            {divisionKeys.map((divKey) => {
              const matchList = matchesByDivision.get(divKey) ?? [];
              const open = isOpen(divKey);
              const label = divKey !== null ? divisionLabelTh(divKey) : "ไม่มีกลุ่ม";
              const tone = divKey !== null ? divisionTone(divKey) : null;
              const completedCount = matchList.filter((m) => m.status === "completed").length;

              return (
                <Card key={String(divKey)}>
                  <CardContent className="space-y-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => toggle(divKey)}>
                      {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {tone && (
                        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${tone.bg} ${tone.border} border`} />
                      )}
                      {label}
                      <span className="ml-1">({completedCount}/{matchList.length})</span>
                    </Button>
                    {open && (
                      <MatchList
                        matches={matchList}
                        competitorById={pairCompetitorMap}
                        tournamentId={tournamentId}
                        isOwner={isOwner}
                        unit="pair"
                        size={matchRowSize}
                      />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </TabsContent>

      {/* Standings */}
      <TabsContent value="standings" className="space-y-3">
        {!showStandings ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีผลการแข่งขัน</p>
        ) : (
          <>
            <h2 className="font-semibold">อันดับ</h2>
            {hasDivisions ? (
              <div className="space-y-4">
                {divisionKeys.filter((k) => k !== null).map((divKey) => {
                  const divMatches = matchesByDivision.get(divKey) ?? [];
                  const divCompetitors = getDivisionCompetitors(divMatches);
                  const tone = divisionTone(divKey!);
                  return (
                    <div key={String(divKey)}>
                      <p className={`text-xs font-medium mb-2 ${tone.text}`}>
                        {divisionLabelTh(divKey!)}
                      </p>
                      <Card>
                        <CardContent className="pt-3">
                          <StandingsTable matches={divMatches} competitors={divCompetitors} unit="pair" />
                        </CardContent>
                      </Card>
                    </div>
                  );
                })}
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
                        {teamAggRows.map((row, i) => {
                          const t = teamById.get(row.competitorId);
                          return (
                            <tr key={row.competitorId} className={i === 0 ? "font-semibold" : ""}>
                              <td className="py-0.5">
                                <div className="flex items-center gap-1.5">
                                  {t?.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />}
                                  <span>{t?.name ?? "—"}</span>
                                </div>
                              </td>
                              <td className="text-center tabular-nums">{row.wins}</td>
                              <td className="text-center tabular-nums">{row.draws}</td>
                              <td className="text-center tabular-nums">{row.losses}</td>
                              <td className="text-center tabular-nums">{row.pointDiff > 0 ? "+" : ""}{row.pointDiff}</td>
                              <td className="text-center font-semibold tabular-nums">{row.leaguePoints}</td>
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
        )}
      </TabsContent>
    </Tabs>
  );
}
