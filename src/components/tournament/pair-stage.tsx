"use client";

import { CsvImportDialog } from "@/components/tournament/csv-import-dialog";
import { ManualMatchDialog } from "@/components/tournament/manual-match-dialog";
import { MatchList } from "@/components/tournament/match-list";
import { PairManager } from "@/components/tournament/pair-manager";
import { ScoreMatrix } from "@/components/tournament/score-matrix";
import { StandingsTable, StandingsSortKeyNote } from "@/components/tournament/standings-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generatePairMatchesAction } from "@/lib/actions/matches";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { parseDivision, divisionTone } from "@/lib/tournament/divisions";
import { classTone } from "@/lib/tournament/class-color";
import { EntityLink } from "@/components/tournament/stats/entity-link";
import { computeStandings, aggregatePairStandingsToTeams } from "@/lib/tournament/scoring";
import type { Level, Match, PairWithPlayers, Team, TeamWithPlayers, TournamentClass } from "@/lib/types";
import { ChevronDown, Loader2, Swords } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

export function PairStage({
  tournamentId,
  teams,
  pairs,
  matches,
  isOwner,
  pairDivisionThresholds = [],
  matchRowSize,
  classes = [],
  levels = [],
}: {
  tournamentId: string;
  teams: TeamWithPlayers[];
  pairs: PairWithPlayers[];
  matches: Match[];
  isOwner: boolean;
  pairDivisionThresholds?: number[];
  matchRowSize?: "compact" | "comfortable";
  /** Competition-mode classes. When present, the pair tab is class-assignment
   *  only — group matches + standings live in the กลุ่ม / น็อคเอ้า tabs. */
  classes?: TournamentClass[];
  /** Skill-level rows (BG…P) for the per-player level Select in PairManager. */
  levels?: Level[];
}) {
  const t = useTranslations("tournament");
  const isCompetition = classes.length > 0;
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

  // Stable per-division competitor arrays so <ScoreMatrix> useMemo doesn't
  // re-run every render (inline getDivisionCompetitors() returns a fresh array).
  const divisionCompetitorsByKey = useMemo(() => {
    const m = new Map<number | null, typeof pairCompetitors>();
    for (const [k, list] of matchesByDivision) {
      const pairIds = [
        ...new Set(
          [
            ...list.map((mt) => mt.pair_a_id),
            ...list.map((mt) => mt.pair_b_id),
          ].filter(Boolean) as string[],
        ),
      ];
      m.set(
        k,
        pairIds
          .map((id) => pairCompetitorMap.get(id))
          .filter(Boolean) as typeof pairCompetitors,
      );
    }
    return m;
  }, [matchesByDivision, pairCompetitorMap]);

  // Aggregate team-level standings from pair matches
  const pairStandings = useMemo(
    () => computeStandings(matches, "pair", pairs.map((p) => p.id)),
    [matches, pairs],
  );
  const teamAggRows = useMemo(
    () => aggregatePairStandingsToTeams(pairStandings, pairs, flatTeams),
    [pairStandings, pairs, flatTeams],
  );

  // closedSet tracks divisions that have been collapsed by the user; default OPEN for all
  const [closedSet, setClosedSet] = useState<Set<string>>(() => new Set());
  const isOpen = (k: number | null) => !closedSet.has(String(k));
  const setOpen = (k: number | null, open: boolean) =>
    setClosedSet((prev) => {
      const next = new Set(prev);
      const s = String(k);
      if (open) next.delete(s);
      else next.add(s);
      return next;
    });

  // matrixDivs tracks which division cards are in "Matrix" view (key = String(divKey))
  const [matrixDivs, setMatrixDivs] = useState<Set<string>>(() => new Set());
  const toggleDivMatrix = (k: number | null) =>
    setMatrixDivs((prev) => {
      const next = new Set(prev);
      const s = String(k);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const totalMatches = matches.length;
  const completedMatches = matches.filter((m) => m.status === "completed").length;
  const hasMatches = totalMatches > 0;
  const totalPairs = pairs.length;
  const teamsWithPairs = pairsByTeam.size;

  const showStandings = hasMatches && completedMatches > 0;
  const hasDivisions = divisionKeys.some((k) => k !== null);

  // Competition mode: the pair tab is class-assignment only. Group matches +
  // standings render in the กลุ่ม / น็อคเอ้า tabs (per-class), so the
  // division-based แข่งขัน / คะแนน sub-tabs are intentionally omitted here.
  const [classFilter, setClassFilter] = useState<string>("all");

  // Per-class pair counts derived from pairs already in component scope.
  const pairCountByClass = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of pairs) {
      if (p.class_id) map.set(p.class_id, (map.get(p.class_id) ?? 0) + 1);
    }
    return map;
  }, [pairs]);

  if (isCompetition) {
    const visibleTeams =
      classFilter === "all"
        ? teams
        : teams.filter((t) =>
            (pairsByTeam.get(t.id) ?? []).some((p) => p.class_id === classFilter),
          );

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("pairStage.title")}</h2>
          {isOwner && <CsvImportDialog tournamentId={tournamentId} onlyMode="pairs" classCodes={classes.map((c) => c.code)} />}
        </div>

        {/* Class filter tabs + per-class cap progress chips */}
        <div className="space-y-2">
          <Tabs value={classFilter} onValueChange={setClassFilter}>
            <TabsList className="w-full flex-wrap h-auto">
              <TabsTrigger value="all">{t("pairStage.tabAll")}</TabsTrigger>
              {classes.map((cls, i) => {
                const tone = classTone(i);
                const count = pairCountByClass.get(cls.id) ?? 0;
                const cap = cls.pair_capacity;
                const full = cap != null && count >= cap;
                return (
                  <TabsTrigger key={cls.id} value={cls.id} className="gap-1.5">
                    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${tone.bg} border ${tone.border}`} />
                    {cls.code}
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1 py-0 ml-0.5 ${tone.border} ${tone.bg} ${tone.text}`}
                    >
                      {cap != null ? `${count}/${cap}` : t("pairStage.pairCountBadge", { count })}
                      {full && t("pairStage.badgeFull")}
                    </Badge>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>

        {teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("pairStage.emptyNeedTeams")}</p>
        ) : visibleTeams.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("pairStage.emptyNoClassPairs")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleTeams.map((t) => (
              <PairManager
                key={t.id}
                team={t}
                pairs={pairsByTeam.get(t.id) ?? []}
                isOwner={isOwner}
                classes={classes}
                levels={levels}
              />
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t("pairStage.hintGenPairs")}
        </p>
      </div>
    );
  }

  return (
    <Tabs defaultValue="pairs" className="space-y-4">
      <TabsList className="w-full flex-wrap h-auto">
        <TabsTrigger value="pairs">{t("pairStage.subTabPairs")}</TabsTrigger>
        <TabsTrigger value="matches">{t("pairStage.subTabMatches")}</TabsTrigger>
        <TabsTrigger value="standings" disabled={!showStandings}>{t("pairStage.subTabStandings")}</TabsTrigger>
      </TabsList>

      {/* Pair manager per team */}
      <TabsContent value="pairs" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("pairStage.subTabPairs")}</h2>
          {isOwner && <CsvImportDialog tournamentId={tournamentId} onlyMode="pairs" />}
        </div>
        {teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("pairStage.emptyNeedTeams")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {teams.map((t) => (
              <PairManager
                key={t.id}
                team={t}
                pairs={pairsByTeam.get(t.id) ?? []}
                isOwner={isOwner}
                levels={levels}
              />
            ))}
          </div>
        )}
      </TabsContent>

      {/* Generate matches */}
      <TabsContent value="matches" className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{t("pairStage.subTabMatches")}</h2>
            {hasMatches && <Badge variant="outline" className="text-xs">{completedMatches}/{totalMatches}</Badge>}
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
                      toast.success(t("pairStage.toastGenMatches", { count: res.count }));
                    }
                  })}>
                  {genPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Swords className="h-3.5 w-3.5 mr-1" />}
                  {t("pairStage.btnGenMatches")}
                </Button>
              )}
            </div>
          )}
        </div>

        {!hasMatches && teamsWithPairs < 2 && (
          <p className="text-sm text-muted-foreground">{t("pairStage.emptyNeedTeams")}</p>
        )}

        {hasMatches && (
          <div className="space-y-3">
            {divisionKeys.map((divKey) => {
              const matchList = matchesByDivision.get(divKey) ?? [];
              const open = isOpen(divKey);
              const label = divKey !== null ? t("division", { n: divKey }) : t("pairStage.noGroupMatches");
              const tone = divKey !== null ? divisionTone(divKey) : null;
              const completedCount = matchList.filter((m) => m.status === "completed").length;

              return (
                <Card key={String(divKey)}>
                  <CardContent className="space-y-2">
                    <Collapsible open={open} onOpenChange={(o) => setOpen(divKey, o)}>
                      <CollapsibleTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start h-auto px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
                          />
                        }
                      >
                        <ChevronDown
                          className={`h-3 w-3 transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
                        />
                        {tone && (
                          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${tone.bg} ${tone.border} border`} />
                        )}
                        {label}
                        <span className="ml-1">({completedCount}/{matchList.length})</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="pt-2 space-y-2">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-pressed={!matrixDivs.has(String(divKey))}
                              className={`h-6 px-2 text-xs ${!matrixDivs.has(String(divKey)) ? "text-foreground font-medium" : "text-muted-foreground"}`}
                              onClick={() => matrixDivs.has(String(divKey)) && toggleDivMatrix(divKey)}>
                              {t("groupStage.viewTable")}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-pressed={matrixDivs.has(String(divKey))}
                              className={`h-6 px-2 text-xs ${matrixDivs.has(String(divKey)) ? "text-foreground font-medium" : "text-muted-foreground"}`}
                              onClick={() => !matrixDivs.has(String(divKey)) && toggleDivMatrix(divKey)}>
                              Matrix
                            </Button>
                          </div>
                          {matrixDivs.has(String(divKey)) ? (
                            <ScoreMatrix
                              matches={matchList}
                              competitors={divisionCompetitorsByKey.get(divKey) ?? []}
                              unit="pair"
                            />
                          ) : (
                            <MatchList
                              matches={matchList}
                              competitorById={pairCompetitorMap}
                              tournamentId={tournamentId}
                              isOwner={isOwner}
                              unit="pair"
                              size={matchRowSize}
                            />
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
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
          <p className="text-sm text-muted-foreground">{t("pairStage.emptyNoResults")}</p>
        ) : (
          <>
            <h2 className="font-semibold">{t("pairStage.subTabStandings")}</h2>
            {hasDivisions ? (
              <div className="space-y-4">
                {divisionKeys.filter((k) => k !== null).map((divKey) => {
                  const divMatches = matchesByDivision.get(divKey) ?? [];
                  const divCompetitors = divisionCompetitorsByKey.get(divKey) ?? [];
                  const tone = divisionTone(divKey!);
                  const open = isOpen(divKey);
                  const completedCount = divMatches.filter((m) => m.status === "completed").length;
                  return (
                    <Collapsible key={String(divKey)} open={open} onOpenChange={(o) => setOpen(divKey, o)}>
                      {/* Header: chevron toggle + division link (kept separate so the
                          EntityLink stays a real link, not nested inside the trigger) */}
                      <div className="flex items-center gap-1.5">
                        <CollapsibleTrigger
                          render={<Button type="button" variant="ghost" size="sm" className="h-6 w-6 px-0 shrink-0" />}
                        >
                          <ChevronDown
                            className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
                          />
                        </CollapsibleTrigger>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${tone.bg} ${tone.border} border`} />
                        <p className={`text-xs font-medium ${tone.text}`}>
                          <EntityLink entityType="division" entityId={String(divKey)}>
                            {t("division", { n: divKey! })}
                          </EntityLink>
                        </p>
                        <span className="text-xs text-muted-foreground">
                          ({completedCount}/{divMatches.length})
                        </span>
                      </div>
                      <CollapsibleContent>
                        <Card className="mt-2">
                          <CardContent className="pt-3">
                            <StandingsTable matches={divMatches} competitors={divCompetitors} unit="pair" />
                          </CardContent>
                        </Card>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{t("pairStage.colTeam")}</CardTitle></CardHeader>
                  <CardContent>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground border-b">
                          <th className="text-left pb-1 font-normal">{t("pairStage.colTeamLabel")}</th>
                          <th className="text-center pb-1 font-normal w-7">W</th>
                          <th className="text-center pb-1 font-normal w-7">D</th>
                          <th className="text-center pb-1 font-normal w-7">L</th>
                          <th className="text-center pb-1 font-normal w-10">+/-</th>
                          <th className="text-center pb-1 font-normal w-8">Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teamAggRows.map((row, i) => {
                          const team = teamById.get(row.competitorId);
                          return (
                            <tr key={row.competitorId} className={i === 0 ? "font-semibold" : ""}>
                              <td className="py-0.5">
                                <div className="flex items-center gap-1.5">
                                  {team?.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: team.color }} />}
                                  <span>{team?.name ?? "—"}</span>
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
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{t("pairStage.colPair")}</CardTitle></CardHeader>
                  <CardContent>
                    <StandingsTable matches={matches} competitors={pairCompetitors} unit="pair" />
                  </CardContent>
                </Card>
              </div>
            )}
            <StandingsSortKeyNote />
          </>
        )}
      </TabsContent>
    </Tabs>
  );
}
