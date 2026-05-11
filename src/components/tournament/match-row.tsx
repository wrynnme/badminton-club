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
}: {
  match: Match;
  competitorById: Map<string, Competitor>;
  tournamentId: string;
  isOwner: boolean;
  unit: "team" | "pair";
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

  return (
    <div className="py-2 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <div className={`flex-1 text-right ${winner === "a" ? "text-green-600 dark:text-green-400 font-semibold" : "font-medium"}`}>
          {a?.color && <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: a.color }} />}
          <span>{a?.name ?? unknownLabel}</span>
          {a?.subtitle && <div className="text-[11px] text-muted-foreground font-normal">{a.subtitle}</div>}
        </div>

        {match.status === "completed" ? (
          <div className="text-center px-2">
            <div className="font-bold tabular-nums">{gamesA} : {gamesB}</div>
            {totals && <div className="text-[10px] text-muted-foreground tabular-nums">({totals.a}–{totals.b})</div>}
          </div>
        ) : (
          <span className="text-muted-foreground px-2 text-xs">vs</span>
        )}

        <div className={`flex-1 ${winner === "b" ? "text-green-600 dark:text-green-400 font-semibold" : "font-medium"}`}>
          {b?.color && <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: b.color }} />}
          <span>{b?.name ?? unknownLabel}</span>
          {b?.subtitle && <div className="text-[11px] text-muted-foreground font-normal">{b.subtitle}</div>}
        </div>

        {isOwner && (
          <div className="flex gap-1">
            {match.status === "completed" ? (
              <Button variant="ghost" size="icon" className="h-6 w-6"
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
