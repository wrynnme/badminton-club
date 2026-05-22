"use client";

import { memo, useState, useTransition } from "react";
import { toast } from "sonner";
import { RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScoreForm } from "@/components/tournament/score-form";
import { resetMatchScoreAction } from "@/lib/actions/matches";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";
import type { Match } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

function MatchRowImpl({
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
  const [resetPending, startReset] = useTransition();

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
    <div className={isComfy ? "py-3 space-y-2 overflow-hidden" : "py-2 space-y-2 overflow-hidden"}>
      <div className={`flex items-center gap-2 ${rowText}`}>
        <div className={`flex-1 min-w-0 text-right ${winner === "a" ? "text-green-600 dark:text-green-400 font-semibold" : "font-medium"}`}>
          {a?.color && <span className={colorDot} style={{ backgroundColor: a.color }} />}
          <span className="truncate block">{a?.name ?? unknownLabel}</span>
          {a?.subtitle && <div className={`${subText} text-muted-foreground font-normal truncate`}>{a.subtitle}</div>}
        </div>

        {match.status === "completed" ? (
          <div className="text-center px-2 shrink-0">
            <div className={scoreText}>{gamesA} : {gamesB}</div>
            {totals && <div className={totalsText}>({totals.a}–{totals.b})</div>}
          </div>
        ) : (
          <span className={`${vsText} shrink-0`}>vs</span>
        )}

        <div className={`flex-1 min-w-0 ${winner === "b" ? "text-green-600 dark:text-green-400 font-semibold" : "font-medium"}`}>
          {b?.color && <span className={colorDot} style={{ backgroundColor: b.color }} />}
          <span className="truncate block">{b?.name ?? unknownLabel}</span>
          {b?.subtitle && <div className={`${subText} text-muted-foreground font-normal truncate`}>{b.subtitle}</div>}
        </div>

        {isOwner && (
          <div className="flex gap-1">
            {match.status === "completed" ? (
              <Button variant="ghost" size="icon" className="h-6 w-6"
                aria-label="รีเซ็ตผลแมตช์"
                disabled={resetPending}
                onClick={() => startReset(async () => {
                  const res = await resetMatchScoreAction(match.id, tournamentId);
                  if (res?.error) toast.error(res.error);
                  else toast.success("รีเซ็ตผลแมตช์แล้ว");
                })}>
                {resetPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
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

export const MatchRow = memo(MatchRowImpl, (prev, next) => {
  if (
    prev.tournamentId !== next.tournamentId ||
    prev.isOwner !== next.isOwner ||
    prev.unit !== next.unit ||
    prev.size !== next.size ||
    prev.competitorById !== next.competitorById
  ) {
    return false;
  }
  const a = prev.match;
  const b = next.match;
  if (
    a.id !== b.id ||
    a.status !== b.status ||
    a.team_a_id !== b.team_a_id ||
    a.team_b_id !== b.team_b_id ||
    a.pair_a_id !== b.pair_a_id ||
    a.pair_b_id !== b.pair_b_id ||
    a.team_a_score !== b.team_a_score ||
    a.team_b_score !== b.team_b_score ||
    a.winner_id !== b.winner_id ||
    a.court !== b.court ||
    a.queue_position !== b.queue_position
  ) {
    return false;
  }
  // games is a small array; JSON compare is cheap and accurate
  if (JSON.stringify(a.games) !== JSON.stringify(b.games)) return false;
  return true;
});
