"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScoreForm } from "@/components/tournament/score-form";
import { resetMatchScoreAction } from "@/lib/actions/matches";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";
import type { Match } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

export function MatchRow({
  match,
  competitorById,
  tournamentId,
  isOwner,
  unit,
  size = "compact",
}: {
  match: Match;
  competitorById: Map<string, Competitor>;
  tournamentId: string;
  isOwner: boolean;
  unit: "team" | "pair";
  size?: "compact" | "comfortable";
}) {
  const [editing, setEditing] = useState(false);
  const [, startReset] = useTransition();

  const aId = unit === "team" ? match.team_a_id : match.pair_a_id;
  const bId = unit === "team" ? match.team_b_id : match.pair_b_id;
  const a = aId ? competitorById.get(aId) : undefined;
  const b = bId ? competitorById.get(bId) : undefined;
  const unknownLabel = unit === "team" ? "TBD" : "—";

  const winner = match.status === "completed" ? gameWinner(match.games) : null;
  const totals = match.status === "completed" ? sumGameScores(match.games) : null;
  const gamesA = match.team_a_score ?? 0;
  const gamesB = match.team_b_score ?? 0;

  const isComfy = size === "comfortable";
  const rowText = isComfy ? "text-base sm:text-lg" : "text-sm";
  const subText = isComfy ? "text-xs sm:text-sm" : "text-[11px]";
  const scoreText = isComfy ? "text-lg sm:text-2xl font-bold tabular-nums" : "font-bold tabular-nums";
  const totalsText = isComfy ? "text-xs sm:text-sm text-muted-foreground tabular-nums" : "text-[10px] text-muted-foreground tabular-nums";
  const vsText = isComfy ? "text-muted-foreground px-2 text-sm" : "text-muted-foreground px-2 text-xs";
  const colorDot = isComfy ? "inline-block w-2.5 h-2.5 rounded-full mr-2" : "inline-block w-2 h-2 rounded-full mr-1.5";

  return (
    <div className={isComfy ? "py-3 space-y-2" : "py-2 space-y-2"}>
      <div className={`flex items-center gap-2 ${rowText}`}>
        <div className={`flex-1 text-right ${winner === "a" ? "text-green-600 dark:text-green-400 font-semibold" : "font-medium"}`}>
          {a?.color && <span className={colorDot} style={{ backgroundColor: a.color }} />}
          <span>{a?.name ?? unknownLabel}</span>
          {a?.subtitle && <div className={`${subText} text-muted-foreground font-normal`}>{a.subtitle}</div>}
        </div>

        {match.status === "completed" ? (
          <div className="text-center px-2">
            <div className={scoreText}>{gamesA} : {gamesB}</div>
            {totals && <div className={totalsText}>({totals.a}–{totals.b})</div>}
          </div>
        ) : (
          <span className={vsText}>vs</span>
        )}

        <div className={`flex-1 ${winner === "b" ? "text-green-600 dark:text-green-400 font-semibold" : "font-medium"}`}>
          {b?.color && <span className={colorDot} style={{ backgroundColor: b.color }} />}
          <span>{b?.name ?? unknownLabel}</span>
          {b?.subtitle && <div className={`${subText} text-muted-foreground font-normal`}>{b.subtitle}</div>}
        </div>

        {isOwner && (
          <div className="flex gap-1">
            {match.status === "completed" ? (
              <Button variant="ghost" size="icon" className="h-6 w-6"
                aria-label="รีเซ็ตผลแมตช์"
                onClick={() => startReset(async () => {
                  const res = await resetMatchScoreAction(match.id, tournamentId);
                  if (res?.error) toast.error(res.error);
                })}>
                <RotateCcw className="h-3 w-3" />
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={() => setEditing(true)}>
                กรอกผล
              </Button>
            )}
          </div>
        )}
      </div>

      {editing && (
        <ScoreForm
          matchId={match.id}
          tournamentId={tournamentId}
          competitorA={a}
          competitorB={b}
          initialGames={match.games}
          onDone={() => setEditing(false)}
        />
      )}
    </div>
  );
}
