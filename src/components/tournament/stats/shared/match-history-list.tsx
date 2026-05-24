"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";
import { RESULT_LABEL_TH, RESULT_TEXT_CLASS } from "@/lib/tournament/result-display";
import type { Match } from "@/lib/types";

export type CompetitorEntry = { id: string; name: string; color?: string | null };

/**
 * Optional extra "my pair" column shown by the Team view between the # column
 * and the opponent column. Other views pass `renderMyColumn=null`.
 */
type RenderMyColumn = ((match: Match, isSideA: boolean) => React.ReactNode) | null;

function MatchHistoryRow({
  match,
  isSideA,
  competitorById,
  renderMyColumn,
}: {
  match: Match;
  isSideA: boolean;
  competitorById: Map<string, CompetitorEntry>;
  renderMyColumn: RenderMyColumn;
}) {
  const opponentId = isSideA ? match.pair_b_id : match.pair_a_id;
  const opponent = opponentId ? competitorById.get(opponentId) : undefined;
  const rawWinner = gameWinner(match.games);
  const totals = sumGameScores(match.games);

  let result: "W" | "L" | "D";
  if (rawWinner === "draw") result = "D";
  else if ((rawWinner === "a" && isSideA) || (rawWinner === "b" && !isSideA)) result = "W";
  else result = "L";

  const myPoints = isSideA ? totals.a : totals.b;
  const oppPoints = isSideA ? totals.b : totals.a;

  const gamesScore = match.games
    .map((g) => (isSideA ? `${g.a}-${g.b}` : `${g.b}-${g.a}`))
    .join(", ");

  const hasMyCol = renderMyColumn !== null;
  const gridCols = hasMyCol
    ? "grid-cols-[2rem_1fr_1fr_3rem_4rem] sm:grid-cols-[2rem_1fr_1fr_3rem_4rem_auto]"
    : "grid-cols-[2rem_1fr_3rem_4rem] sm:grid-cols-[2rem_1fr_3rem_4rem_auto]";

  return (
    <div
      className={`grid ${gridCols} items-center gap-x-2 px-4 py-2.5 border-b last:border-b-0 text-sm`}
    >
      <span className="text-muted-foreground text-xs tabular-nums">#{match.match_number}</span>
      {hasMyCol && (
        <span className="truncate min-w-0 text-xs text-muted-foreground">
          {renderMyColumn(match, isSideA)}
        </span>
      )}
      <span className="truncate min-w-0">
        {opponent?.name ?? <span className="text-muted-foreground">—</span>}
      </span>
      <span className={RESULT_TEXT_CLASS[result]}>{RESULT_LABEL_TH[result]}</span>
      <span className="tabular-nums text-right font-medium">
        {myPoints}–{oppPoints}
      </span>
      <span className="text-xs text-muted-foreground hidden sm:block">{gamesScore}</span>
    </div>
  );
}

/**
 * Card-wrapped chronological match-history list shared by pair / player /
 * team stats views. Side-A detection is delegated via `isSideA` so the same
 * row layout works for entity types that compute "my side" differently:
 *  - pair: `m.pair_a_id === pairId`
 *  - player: `playerPairIds.has(m.pair_a_id ?? "")`
 *  - team: `teamPairIds.has(m.pair_a_id ?? "")`
 *
 * Team view supplies `renderMyColumn` (and `myColumnLabel="คู่ (ทีม)"`)
 * to surface the active pair name.
 */
export function MatchHistoryList({
  matches,
  isSideA,
  competitorById,
  title = "ประวัติแมตช์",
  emptyText = "ยังไม่มีแมตช์ที่เสร็จสิ้น",
  myColumnLabel,
  renderMyColumn = null,
}: {
  matches: Match[];
  isSideA: (match: Match) => boolean;
  competitorById: Map<string, CompetitorEntry>;
  title?: string;
  emptyText?: string;
  myColumnLabel?: string;
  renderMyColumn?: RenderMyColumn;
}) {
  const hasMyCol = renderMyColumn !== null;
  const gridCols = hasMyCol
    ? "grid-cols-[2rem_1fr_1fr_3rem_4rem] sm:grid-cols-[2rem_1fr_1fr_3rem_4rem_auto]"
    : "grid-cols-[2rem_1fr_3rem_4rem] sm:grid-cols-[2rem_1fr_3rem_4rem_auto]";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {matches.length === 0 ? (
          <p className="text-sm text-muted-foreground px-6 pb-6">{emptyText}</p>
        ) : (
          <div>
            <div
              className={`grid ${gridCols} gap-x-2 px-4 py-2 border-b bg-muted/40 text-xs text-muted-foreground font-medium`}
            >
              <span>#</span>
              {hasMyCol && <span>{myColumnLabel ?? ""}</span>}
              <span>คู่แข่ง</span>
              <span>ผล</span>
              <span className="text-right">คะแนน</span>
              <span className="hidden sm:block">เกม</span>
            </div>
            {matches.map((m) => (
              <MatchHistoryRow
                key={m.id}
                match={m}
                isSideA={isSideA(m)}
                competitorById={competitorById}
                renderMyColumn={renderMyColumn}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
