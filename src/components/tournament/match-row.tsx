"use client";

import { memo, useState, useTransition } from "react";
import { toast } from "sonner";
import { RotateCcw, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ScoreForm } from "@/components/tournament/score-form";
import { EntityLink } from "@/components/tournament/stats/entity-link";
import { resetMatchScoreAction } from "@/lib/actions/matches";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";
import { maxGamesForFormat } from "@/lib/tournament/match-format";
import type { Match, MatchFormat } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

function MatchRowImpl({
  match,
  competitorById,
  tournamentId,
  isOwner,
  unit,
  size = "compact",
  matchFormatById,
}: {
  match: Match;
  competitorById: Map<string, Competitor>;
  tournamentId: string;
  isOwner: boolean;
  unit: "team" | "pair";
  size?: "compact" | "comfortable";
  matchFormatById?: Map<string, MatchFormat>;
}) {
  const t = useTranslations("tournament");
  const [editing, setEditing] = useState(false);
  const [resetPending, startReset] = useTransition();

  const fmt = match.class_id ? matchFormatById?.get(match.class_id) : undefined;
  const maxGames = fmt ? maxGamesForFormat(fmt) : undefined;

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
        <div className={`flex-1 min-w-0 text-right ${winner === "a" ? "text-winner font-semibold" : "font-medium"}`}>
          {a?.color && <span className={colorDot} style={{ backgroundColor: a.color }} />}
          <EntityLink entityType={unit === "pair" ? "pair" : "team"} entityId={aId}>
            <span className="truncate block">{a?.name ?? unknownLabel}</span>
          </EntityLink>
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

        <div className={`flex-1 min-w-0 ${winner === "b" ? "text-winner font-semibold" : "font-medium"}`}>
          {b?.color && <span className={colorDot} style={{ backgroundColor: b.color }} />}
          <EntityLink entityType={unit === "pair" ? "pair" : "team"} entityId={bId}>
            <span className="truncate block">{b?.name ?? unknownLabel}</span>
          </EntityLink>
          {b?.subtitle && <div className={`${subText} text-muted-foreground font-normal truncate`}>{b.subtitle}</div>}
        </div>

        {isOwner && (
          <div className="flex gap-1">
            {match.status === "completed" ? (
              <Button variant="ghost" size="icon" className="h-6 w-6"
                aria-label={t("matchRow.ariaReset")}
                disabled={resetPending}
                onClick={() => startReset(async () => {
                  const res = await resetMatchScoreAction(match.id, tournamentId);
                  if (res?.error) toast.error(res.error);
                  else toast.success(t("matchRow.toastReset"));
                })}>
                {resetPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={() => setEditing(true)}>
                {t("matchRow.btnEnterScore")}
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
          maxGames={maxGames}
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
    prev.competitorById !== next.competitorById ||
    prev.matchFormatById !== next.matchFormatById
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
  if ((a.games?.length ?? 0) !== (b.games?.length ?? 0)) return false;
  const ag = a.games ?? [];
  const bg = b.games ?? [];
  for (let i = 0; i < ag.length; i++) {
    if (ag[i].a !== bg[i].a || ag[i].b !== bg[i].b) return false;
  }
  return true;
});
