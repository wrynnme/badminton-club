"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { RefreshCw, Trophy, GitBranch, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { MatchRow } from "@/components/tournament/match-row";
import { generateKnockoutAction } from "@/lib/actions/matches";
import { buildCompetitorMap, teamToCompetitor } from "@/lib/tournament/competitor";
import { roundLabel, lowerRoundLabel } from "@/lib/tournament/bracket";
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
          ? "รอบชิงชนะเลิศ"
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
                          <span>{winner?.name ?? "—"} ผ่านโดยอัตโนมัติ</span>
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
}) {
  const [isPending, startGen] = useTransition();

  const competitorMap = buildCompetitorMap(matchUnit, teams, pairs ?? []);

  // Build requirements checklist
  const reqs: Req[] = [];
  if (matchUnit === "pair") {
    const pairCount = (pairs ?? []).length;
    reqs.push({ label: `มีคู่อย่างน้อย 2 คู่ (มี ${pairCount} คู่)`, met: pairCount >= 2 });
    if (format === "group_knockout") {
      reqs.push({ label: `มีตารางแข่งกลุ่ม (${groupMatchTotal ?? 0} นัด)`, met: (groupMatchTotal ?? 0) > 0 });
      reqs.push({ label: `มีผลกลุ่มอย่างน้อย 1 นัด (${groupMatchCompleted ?? 0}/${groupMatchTotal ?? 0})`, met: (groupMatchCompleted ?? 0) > 0 });
    }
  } else {
    reqs.push({ label: `มีทีมอย่างน้อย 2 ทีม (มี ${teams.length} ทีม)`, met: teams.length >= 2 });
    if (format === "group_knockout") {
      reqs.push({ label: `แบ่งกลุ่มแล้ว (${groupCount ?? 0} กลุ่ม)`, met: (groupCount ?? 0) > 0 });
      reqs.push({ label: `มีผลกลุ่มครบทุกนัด (${groupMatchCompleted ?? 0}/${groupMatchTotal ?? 0})`, met: (groupMatchTotal ?? 0) > 0 && groupMatchCompleted === groupMatchTotal });
    }
  }
  const allReqsMet = reqs.every((r) => r.met);

  const upperMatches = matches.filter((m) => !m.bracket || m.bracket === "upper");
  const lowerMatches = matches.filter((m) => m.bracket === "lower");
  const grandFinalMatches = matches.filter((m) => m.bracket === "grand_final");
  const hasLower = lowerMatches.length > 0;
  const hasGrandFinal = grandFinalMatches.length > 0;
  const hasMatches = matches.length > 0;

  const maxUpperRound = upperMatches.length > 0 ? Math.max(...upperMatches.map((m) => m.round_number)) : 0;
  const upperBracketSize = Math.pow(2, maxUpperRound);
  const totalLowerRounds = lowerMatches.length > 0 ? Math.max(...lowerMatches.map((m) => m.round_number)) : 0;

  const completedPlayable = matches.filter(
    (m) => m.status === "completed" && (m.team_a_id || m.pair_a_id) && (m.team_b_id || m.pair_b_id)
  ).length;
  const totalPlayable = matches.filter(
    (m) => (m.team_a_id || m.pair_a_id) && (m.team_b_id || m.pair_b_id)
  ).length;

  // Find champion from grand final (or upper final if no lower bracket)
  const finalMatch = hasGrandFinal
    ? grandFinalMatches[0]
    : upperMatches.find((m) => m.round_number === maxUpperRound);
  const champion = finalMatch?.status === "completed" && finalMatch.winner_id
    ? competitorMap.get(finalMatch.winner_id)
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">รอบ Knockout</h2>
          {hasMatches && totalPlayable > 0 && (
            <Badge variant="outline" className="text-xs">{completedPlayable}/{totalPlayable} แมตช์</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasMatches && (
            <Button render={<Link href={`/tournaments/${tournamentId}/bracket`} />} nativeButton={false} size="sm" variant="outline">
              <GitBranch className="h-3.5 w-3.5 mr-1" />
              ดูสาย
            </Button>
          )}
          {isOwner && (
            <Button
              size="sm"
              variant={hasMatches ? "outline" : "default"}
              disabled={!allReqsMet || isPending}
              onClick={() =>
                startGen(async () => {
                  const res = await generateKnockoutAction(tournamentId);
                  if ("error" in res) toast.error(res.error);
                  else toast.success(`สร้าง bracket ${res.count} แมตช์แล้ว`);
                })
              }
            >
              {isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              {hasMatches ? "สร้าง bracket ใหม่" : "สร้าง bracket"}
            </Button>
          )}
        </div>
      </div>

      {/* Requirements checklist */}
      {reqs.length > 0 && (!hasMatches || !allReqsMet) && (
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
            <p className="text-xs text-muted-foreground pt-1">พร้อมสร้าง bracket แล้ว</p>
          )}
        </div>
      )}

      {hasMatches && (
        <div className="space-y-6">
          {/* Upper bracket */}
          <BracketSection
            label={hasLower ? "สายบน (Upper)" : ""}
            matches={upperMatches}
            maxRound={maxUpperRound}
            bracketSize={upperBracketSize}
            competitorMap={competitorMap}
            tournamentId={tournamentId}
            isOwner={isOwner}
            unit={matchUnit}
            matchRowSize={matchRowSize}
          />

          {/* Lower bracket */}
          {hasLower && (
            <>
              <Separator />
              <BracketSection
                label="สายล่าง (Lower)"
                matches={lowerMatches}
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
                label="Grand Final"
                matches={grandFinalMatches}
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
                  <div className="text-xs text-muted-foreground">แชมป์</div>
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
        </div>
      )}
    </div>
  );
}
