"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { RefreshCw, Trophy, GitBranch, CheckCircle2, XCircle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { MatchRow } from "@/components/tournament/match-row";
import { generateKnockoutAction } from "@/lib/actions/matches";
import { generateKnockoutForClassAction } from "@/lib/actions/classes";
import { buildCompetitorMap, teamToCompetitor } from "@/lib/tournament/competitor";
import { roundLabel, lowerRoundLabel } from "@/lib/tournament/bracket";
import { parseDivision, divisionTone } from "@/lib/tournament/divisions";
import type { Match, Team, MatchUnit, PairWithPlayers } from "@/lib/types";

function BracketSection({
  label,
  matches,
  maxRound,
  bracketSize,
  competitorMap,
  tournamentId,
  isOwner,
  unit,
  isFinalBracket = false,
  totalLowerRounds = 0,
  isLower = false,
  matchRowSize,
}: {
  label: string;
  matches: Match[];
  maxRound: number;
  bracketSize: number;
  competitorMap: Map<string, ReturnType<typeof teamToCompetitor>>;
  tournamentId: string;
  isOwner: boolean;
  unit: MatchUnit;
  isFinalBracket?: boolean;
  totalLowerRounds?: number;
  isLower?: boolean;
  matchRowSize?: "compact" | "comfortable";
}) {
  const t = useTranslations("tournament");
  const rounds = new Map<number, Match[]>();
  for (const m of matches) {
    if (!rounds.has(m.round_number)) rounds.set(m.round_number, []);
    rounds.get(m.round_number)!.push(m);
  }
  const sortedRounds = [...rounds.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <div className="space-y-4">
      <h3 className={`text-sm font-semibold ${isFinalBracket ? "text-yellow-600 dark:text-yellow-400" : ""}`}>
        {isFinalBracket && <Trophy className="inline h-4 w-4 mr-1 text-yellow-500" />}
        {label}
      </h3>
      {sortedRounds.map(([round, roundMatches]) => {
        const rl = isLower
          ? lowerRoundLabel(round, totalLowerRounds)
          : isFinalBracket
          ? t("knockoutStage.grandFinalRound")
          : roundLabel(round, maxRound, bracketSize);

        return (
          <div key={round} className="space-y-1">
            <p className="text-xs text-muted-foreground">{rl}</p>
            <Card>
              <CardContent className="pt-3 divide-y">
                {roundMatches
                  .sort((a, b) => a.match_number - b.match_number)
                  .map((m) => {
                    const aId = unit === "pair" ? m.pair_a_id : m.team_a_id;
                    const bId = unit === "pair" ? m.pair_b_id : m.team_b_id;
                    // BYE: one side null, match completed
                    if (m.status === "completed" && (!aId || !bId)) {
                      const winner = competitorMap.get(m.winner_id ?? "");
                      return (
                        <div key={m.id} className="py-2 text-xs text-muted-foreground flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">BYE</Badge>
                          <span>{winner?.name ?? "—"} {t("knockoutStage.byeAuto")}</span>
                        </div>
                      );
                    }
                    return (
                      <MatchRow
                        key={m.id}
                        match={m}
                        competitorById={competitorMap}
                        tournamentId={tournamentId}
                        isOwner={isOwner}
                        unit={unit}
                        size={matchRowSize}
                      />
                    );
                  })}
              </CardContent>
            </Card>
          </div>
        );
      })}
    </div>
  );
}

type Req = { label: string; met: boolean };

export function KnockoutStage({
  tournamentId,
  matches,
  teams,
  pairs,
  matchUnit,
  advanceCount,
  isOwner,
  format,
  groupCount,
  groupMatchTotal,
  groupMatchCompleted,
  matchRowSize,
  classId,
}: {
  tournamentId: string;
  matches: Match[];
  teams: Team[];
  pairs?: PairWithPlayers[];
  matchUnit: MatchUnit;
  advanceCount: number;
  isOwner: boolean;
  format: "group_only" | "group_knockout" | "knockout_only";
  groupCount?: number;
  groupMatchTotal?: number;
  groupMatchCompleted?: number;
  matchRowSize?: "compact" | "comfortable";
  /** When set, this stage is scoped to a competition class — generate uses the
   *  per-class action instead of the tournament-wide one. */
  classId?: string;
}) {
  const t = useTranslations("tournament");
  const [isPending, startGen] = useTransition();

  const competitorMap = useMemo(
    () => buildCompetitorMap(matchUnit, teams, pairs ?? []),
    [matchUnit, teams, pairs],
  );

  const matchesByDivision = useMemo(() => {
    const m = new Map<number | null, Match[]>();
    for (const x of matches) {
      const k = parseDivision(x.division);
      const arr = m.get(k) ?? [];
      arr.push(x);
      m.set(k, arr);
    }
    return m;
  }, [matches]);

  const divisionKeysMemo = useMemo(
    () => Array.from(matchesByDivision.keys()).sort((a, b) =>
      a === null ? 1 : b === null ? -1 : a - b
    ),
    [matchesByDivision],
  );

  // Build requirements checklist
  const reqs: Req[] = [];
  if (matchUnit === "pair") {
    const pairCount = (pairs ?? []).length;
    reqs.push({ label: t("knockoutStage.reqPairCount", { count: pairCount }), met: pairCount >= 2 });
    if (format === "group_knockout") {
      reqs.push({ label: t("knockoutStage.reqGroupMatches", { count: groupMatchTotal ?? 0 }), met: (groupMatchTotal ?? 0) > 0 });
      reqs.push({ label: t("knockoutStage.reqGroupResult", { completed: groupMatchCompleted ?? 0, total: groupMatchTotal ?? 0 }), met: (groupMatchCompleted ?? 0) > 0 });
    }
  } else {
    reqs.push({ label: t("knockoutStage.reqTeamCount", { count: teams.length }), met: teams.length >= 2 });
    if (format === "group_knockout") {
      reqs.push({ label: t("knockoutStage.reqGroupsDone", { count: groupCount ?? 0 }), met: (groupCount ?? 0) > 0 });
      reqs.push({ label: t("knockoutStage.reqGroupComplete", { completed: groupMatchCompleted ?? 0, total: groupMatchTotal ?? 0 }), met: (groupMatchTotal ?? 0) > 0 && groupMatchCompleted === groupMatchTotal });
    }
  }
  const allReqsMet = reqs.every((r) => r.met);

  const hasMatches = matches.length > 0;

  // Collect distinct numeric divisions present in knockout matches (null = no division split)
  const divisionKeys = divisionKeysMemo;
  const isMultiDivision = divisionKeys.some((k) => k !== null);

  // Helper: split a set of matches into upper/lower/grand_final sub-sections
  function splitBrackets(ms: Match[]) {
    const upper = ms.filter((m) => !m.bracket || m.bracket === "upper");
    const lower = ms.filter((m) => m.bracket === "lower");
    const grandFinal = ms.filter((m) => m.bracket === "grand_final");
    return { upper, lower, grandFinal };
  }

  // For progress badge
  const completedPlayable = matches.filter(
    (m) => m.status === "completed" && (m.team_a_id || m.pair_a_id) && (m.team_b_id || m.pair_b_id)
  ).length;
  const totalPlayable = matches.filter(
    (m) => (m.team_a_id || m.pair_a_id) && (m.team_b_id || m.pair_b_id)
  ).length;

  // Per-division collapse state — default OPEN; collapsedSet tracks user-collapsed divisions
  const [closedSet, setClosedSet] = useState<Set<string>>(() => new Set());
  const isDivOpen = (k: number | null) => !closedSet.has(String(k));
  const setDivOpen = (k: number | null, open: boolean) =>
    setClosedSet((prev) => {
      const next = new Set(prev);
      const s = String(k);
      if (open) next.delete(s);
      else next.add(s);
      return next;
    });

  // Champion(s): one per division (or single when no division split)
  const champions = divisionKeys.map((divKey) => {
    const divMatches = matchesByDivision.get(divKey) ?? [];
    const { upper, grandFinal } = splitBrackets(divMatches);
    const maxUpperRound = upper.length > 0 ? Math.max(...upper.map((m) => m.round_number)) : 0;
    const finalMatch = grandFinal.length > 0
      ? grandFinal[0]
      : upper.find((m) => m.round_number === maxUpperRound);
    const champion = finalMatch?.status === "completed" && finalMatch.winner_id
      ? competitorMap.get(finalMatch.winner_id) ?? null
      : null;
    return { divKey, champion };
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">{t("knockoutStage.sectionTitle")}</h2>
          {hasMatches && totalPlayable > 0 && (
            <Badge variant="outline" className="text-xs">{completedPlayable}/{totalPlayable} {t("knockoutStage.sectionTitle")}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasMatches && (
            <Button render={<Link href={`/tournaments/${tournamentId}/bracket`} />} nativeButton={false} size="sm" variant="outline">
              <GitBranch className="h-3.5 w-3.5 mr-1" />
              {t("knockoutStage.btnViewBracket")}
            </Button>
          )}
          {isOwner && (
            <Button
              size="sm"
              variant={hasMatches ? "outline" : "default"}
              disabled={!allReqsMet || isPending}
              onClick={() =>
                startGen(async () => {
                  const res = classId
                    ? await generateKnockoutForClassAction(classId)
                    : await generateKnockoutAction(tournamentId);
                  if ("error" in res) toast.error(res.error);
                  else toast.success(t("knockoutStage.toastGenerated", { count: res.count }));
                })
              }
            >
              {isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              {hasMatches ? t("knockoutStage.btnRegenBracket") : t("knockoutStage.btnGenBracket")}
            </Button>
          )}
        </div>
      </div>

      {/* Empty state for public viewers */}
      {!isOwner && !hasMatches && (
        <p className="text-sm text-muted-foreground py-8 text-center">{t("knockoutStage.emptyPublic")}</p>
      )}

      {/* Requirements checklist — admin only */}
      {isOwner && reqs.length > 0 && (!hasMatches || !allReqsMet) && (
        <div className="space-y-1.5">
          {reqs.map((r) => (
            <div key={r.label} className="flex items-center gap-2 text-sm">
              {r.met
                ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                : <XCircle className="h-4 w-4 text-destructive shrink-0" />}
              <span className={r.met ? "text-muted-foreground" : ""}>{r.label}</span>
            </div>
          ))}
          {allReqsMet && !hasMatches && (
            <p className="text-xs text-muted-foreground pt-1">{t("knockoutStage.readyToGen")}</p>
          )}
        </div>
      )}

      {hasMatches && (
        <div className="space-y-6">
          {divisionKeys.map((divKey, dIdx) => {
            const divMatches = matchesByDivision.get(divKey) ?? [];
            const { upper, lower, grandFinal } = splitBrackets(divMatches);
            const hasLower = lower.length > 0;
            const hasGrandFinal = grandFinal.length > 0;
            const maxUpperRound = upper.length > 0 ? Math.max(...upper.map((m) => m.round_number)) : 0;
            const upperBracketSize = Math.pow(2, maxUpperRound);
            const totalLowerRounds = lower.length > 0 ? Math.max(...lower.map((m) => m.round_number)) : 0;
            const tone = divKey !== null ? divisionTone(divKey) : null;
            const { champion } = champions[dIdx];

            const divPlayableTotal = divMatches.filter(
              (m) => (m.team_a_id || m.pair_a_id) && (m.team_b_id || m.pair_b_id),
            ).length;
            const divPlayableCompleted = divMatches.filter(
              (m) =>
                m.status === "completed" &&
                (m.team_a_id || m.pair_a_id) &&
                (m.team_b_id || m.pair_b_id),
            ).length;
            const divOpen = isMultiDivision ? isDivOpen(divKey) : true;

            const sectionsBody = (
              <>
                {/* Upper / winner bracket */}
                <BracketSection
                  label={hasLower ? t("knockoutStage.bracketWinner") : ""}
                  matches={upper}
                  maxRound={maxUpperRound}
                  bracketSize={upperBracketSize}
                  competitorMap={competitorMap}
                  tournamentId={tournamentId}
                  isOwner={isOwner}
                  unit={matchUnit}
                  matchRowSize={matchRowSize}
                />

                {/* Lower / loser bracket */}
                {hasLower && (
                  <>
                    <Separator />
                    <BracketSection
                      label={t("knockoutStage.bracketLoser")}
                      matches={lower}
                      maxRound={totalLowerRounds}
                      bracketSize={0}
                      competitorMap={competitorMap}
                      tournamentId={tournamentId}
                      isOwner={isOwner}
                      unit={matchUnit}
                      isLower
                      totalLowerRounds={totalLowerRounds}
                      matchRowSize={matchRowSize}
                    />
                  </>
                )}

                {/* Grand final */}
                {hasGrandFinal && (
                  <>
                    <Separator />
                    <BracketSection
                      label={t("knockoutStage.bracketGrandFinal")}
                      matches={grandFinal}
                      maxRound={1}
                      bracketSize={2}
                      competitorMap={competitorMap}
                      tournamentId={tournamentId}
                      isOwner={isOwner}
                      unit={matchUnit}
                      isFinalBracket
                      matchRowSize={matchRowSize}
                    />
                  </>
                )}

                {/* Champion banner */}
                {champion && (
                  <>
                    <Separator />
                    <div className="flex items-center gap-3 p-4 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-700">
                      <Trophy className="h-6 w-6 text-yellow-500 shrink-0" />
                      <div>
                        <div className="text-xs text-muted-foreground">
                          {isMultiDivision && divKey !== null
                            ? t("knockoutStage.championDiv", { div: t("division", { n: divKey }) })
                            : t("knockoutStage.champion")}
                        </div>
                        <div className="font-bold text-lg flex items-center gap-2">
                          {champion.color && (
                            <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: champion.color }} />
                          )}
                          {champion.name}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            );

            return (
              <div key={String(divKey)} className="space-y-4">
                {isMultiDivision && divKey !== null ? (
                  <Collapsible
                    open={divOpen}
                    onOpenChange={(o) => setDivOpen(divKey, o)}
                    className="space-y-4"
                  >
                    {/* Division heading as trigger */}
                    <CollapsibleTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={`w-full justify-start h-auto px-1 py-1 pb-1 border-b rounded-none text-sm font-semibold ${tone?.text ?? ""}`}
                        />
                      }
                    >
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform duration-200 ${divOpen ? "" : "-rotate-90"}`}
                      />
                      <span className={`inline-block w-2 h-2 rounded-full ${tone?.bg ?? ""} border ${tone?.border ?? ""}`} />
                      <span>{t("division", { n: divKey })}</span>
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        ({divPlayableCompleted}/{divPlayableTotal})
                      </span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4">
                      {sectionsBody}
                    </CollapsibleContent>
                  </Collapsible>
                ) : (
                  sectionsBody
                )}

                {/* Separator between divisions */}
                {isMultiDivision && dIdx < divisionKeys.length - 1 && (
                  <Separator className="mt-2" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
