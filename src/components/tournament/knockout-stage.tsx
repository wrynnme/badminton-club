"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { MatchRow } from "@/components/tournament/match-row";
import { generateKnockoutAction } from "@/lib/actions/matches";
import { teamToCompetitor } from "@/lib/tournament/competitor";
import { roundLabel } from "@/lib/tournament/bracket";
import type { Match, Team } from "@/lib/types";

export function KnockoutStage({
  tournamentId,
  matches,
  teams,
  advanceCount,
  isOwner,
}: {
  tournamentId: string;
  matches: Match[];
  teams: Team[];
  advanceCount: number;
  isOwner: boolean;
}) {
  const [, startGen] = useTransition();

  const competitorMap = new Map(teams.map((t) => [t.id, teamToCompetitor(t)]));

  const hasMatches = matches.length > 0;
  const completedMatches = matches.filter((m) => m.status === "completed" && m.team_a_id && m.team_b_id).length;
  const totalPlayableMatches = matches.filter((m) => m.team_a_id && m.team_b_id).length;

  // Group by round_number
  const maxRound = hasMatches ? Math.max(...matches.map((m) => m.round_number)) : 0;
  const bracketSize = hasMatches ? Math.pow(2, maxRound) : 0;
  const rounds = new Map<number, Match[]>();
  for (const m of matches) {
    if (!rounds.has(m.round_number)) rounds.set(m.round_number, []);
    rounds.get(m.round_number)!.push(m);
  }
  const sortedRounds = [...rounds.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">รอบ Knockout</h2>
          {hasMatches && (
            <Badge variant="outline" className="text-xs">
              {completedMatches}/{totalPlayableMatches} แมตช์
            </Badge>
          )}
        </div>
        {isOwner && (
          <Button
            size="sm"
            variant={hasMatches ? "outline" : "default"}
            onClick={() =>
              startGen(async () => {
                const res = await generateKnockoutAction(tournamentId);
                if (res?.error) toast.error(res.error);
                else toast.success(`สร้าง bracket ${res.count} แมตช์แล้ว`);
              })
            }
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            {hasMatches ? "สร้าง bracket ใหม่" : "สร้าง bracket"}
          </Button>
        )}
      </div>

      {!hasMatches && (
        <p className="text-sm text-muted-foreground">
          {isOwner
            ? `กด "สร้าง bracket" — ดึง top ${advanceCount} จากแต่ละกลุ่มเข้า knockout อัตโนมัติ`
            : "ยังไม่มี bracket"}
        </p>
      )}

      {hasMatches && (
        <div className="space-y-6">
          {sortedRounds.map(([round, roundMatches]) => {
            const label = roundLabel(round, maxRound, bracketSize);
            const isFinal = round === maxRound;
            return (
              <div key={round} className="space-y-2">
                <div className="flex items-center gap-2">
                  {isFinal && <Trophy className="h-4 w-4 text-yellow-500" />}
                  <h3 className={`text-sm font-medium ${isFinal ? "text-yellow-600 dark:text-yellow-400" : ""}`}>
                    {label}
                  </h3>
                </div>
                <Card>
                  <CardContent className="pt-3 divide-y">
                    {roundMatches
                      .sort((a, b) => a.match_number - b.match_number)
                      .map((m) => {
                        // BYE match: one side is null — show as auto-advance
                        if (m.status === "completed" && (!m.team_a_id || !m.team_b_id)) {
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
                            unit="team"
                          />
                        );
                      })}
                  </CardContent>
                </Card>
              </div>
            );
          })}

          {/* Champion */}
          {(() => {
            const finalMatch = matches.find((m) => m.round_number === maxRound);
            if (finalMatch?.status === "completed" && finalMatch.winner_id) {
              const champion = competitorMap.get(finalMatch.winner_id);
              if (!champion) return null;
              return (
                <>
                  <Separator />
                  <div className="flex items-center gap-3 p-4 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-700">
                    <Trophy className="h-6 w-6 text-yellow-500 shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground">แชมป์</div>
                      <div className="font-bold text-lg">
                        {champion.color && (
                          <span className="inline-block w-3 h-3 rounded-full mr-2 shrink-0 align-middle" style={{ backgroundColor: champion.color }} />
                        )}
                        {champion.name}
                      </div>
                    </div>
                  </div>
                </>
              );
            }
            return null;
          })()}
        </div>
      )}
    </div>
  );
}
