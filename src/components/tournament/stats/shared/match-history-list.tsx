"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";
import { RESULT_LABEL_TH, RESULT_TEXT_CLASS } from "@/lib/tournament/result-display";
import { EntityLink } from "@/components/tournament/stats/entity-link";
import type { Match } from "@/lib/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type CompetitorEntry = { id: string; name: string; color?: string | null };

/**
 * Optional extra "my pair" column shown by the Team view between the # column
 * and the opponent column. Other views pass `renderMyColumn=null`.
 */
type RenderMyColumn = ((match: Match, isSideA: boolean) => React.ReactNode) | null;

/**
 * Renders the opponent's display name as a node — pair / team views pass their
 * own renderer so the name links to the relevant stats page. The default wraps
 * in an `<EntityLink entityType="pair">` since pair is by far the most common case.
 */
export type OpponentNameRenderer = (
  name: string,
  id: string,
) => ReactNode;

const defaultOpponentRenderer: OpponentNameRenderer = (name, id) => (
  <EntityLink entityType="pair" entityId={id}>
    {name}
  </EntityLink>
);

function MatchHistoryRow({
  match,
  isSideA,
  competitorById,
  renderMyColumn,
  renderOpponentName,
}: {
  match: Match;
  isSideA: boolean;
  competitorById: Map<string, CompetitorEntry>;
  renderMyColumn: RenderMyColumn;
  renderOpponentName: OpponentNameRenderer;
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

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="text-muted-foreground text-xs tabular-nums py-2.5 w-8">
        #{match.match_number}
      </TableCell>
      {hasMyCol && (
        <TableCell className="text-xs text-muted-foreground py-2.5 max-w-[8rem] whitespace-normal">
          <span className="block truncate">
            {renderMyColumn(match, isSideA)}
          </span>
        </TableCell>
      )}
      <TableCell className="py-2.5 whitespace-normal max-w-0 w-full">
        <span className="block truncate">
          {opponent && opponentId ? (
            renderOpponentName(opponent.name, opponentId)
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      </TableCell>
      <TableCell className={`text-right py-2.5 w-12 ${RESULT_TEXT_CLASS[result]}`}>
        {RESULT_LABEL_TH[result]}
      </TableCell>
      <TableCell className="tabular-nums text-right font-medium py-2.5 w-14">
        {myPoints}–{oppPoints}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground tabular-nums text-right py-2.5 hidden sm:table-cell">
        {gamesScore}
      </TableCell>
    </TableRow>
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
 * Team view supplies `renderMyColumn` (and `myColumnLabel`) to surface the
 * active pair name.
 */
export function MatchHistoryList({
  matches,
  isSideA,
  competitorById,
  title,
  emptyText,
  myColumnLabel,
  renderMyColumn = null,
  renderOpponentName = defaultOpponentRenderer,
}: {
  matches: Match[];
  isSideA: (match: Match) => boolean;
  competitorById: Map<string, CompetitorEntry>;
  title?: string;
  emptyText?: string;
  myColumnLabel?: string;
  renderMyColumn?: RenderMyColumn;
  /**
   * Render the opponent's display name (link / span / etc.). Pair and player
   * views can rely on the default (links to the opponent pair's stats page);
   * team view passes a "team" renderer so the opponent column links to the
   * opposing team stats. Pass `(name) => name` to render unwrapped text.
   */
  renderOpponentName?: OpponentNameRenderer;
}) {
  const t = useTranslations("stats.matchHistoryList");

  const resolvedTitle = title ?? t("defaultTitle");
  const resolvedEmpty = emptyText ?? t("defaultEmpty");
  const hasMyCol = renderMyColumn !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{resolvedTitle}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {matches.length === 0 ? (
          <p className="text-sm text-muted-foreground px-6 pb-6">{resolvedEmpty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="text-muted-foreground font-medium text-xs h-9 w-8">
                  #
                </TableHead>
                {hasMyCol && (
                  <TableHead className="text-muted-foreground font-medium text-xs h-9 max-w-[8rem]">
                    {myColumnLabel ?? ""}
                  </TableHead>
                )}
                <TableHead className="text-muted-foreground font-medium text-xs h-9">
                  {t("colOpponent")}
                </TableHead>
                <TableHead className="text-right text-muted-foreground font-medium text-xs h-9 w-12">
                  {t("colResult")}
                </TableHead>
                <TableHead className="text-right text-muted-foreground font-medium text-xs h-9 w-14">
                  {t("colScore")}
                </TableHead>
                <TableHead className="text-right text-muted-foreground font-medium text-xs h-9 hidden sm:table-cell">
                  {t("colGames")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matches.map((m) => (
                <MatchHistoryRow
                  key={m.id}
                  match={m}
                  isSideA={isSideA(m)}
                  competitorById={competitorById}
                  renderMyColumn={renderMyColumn}
                  renderOpponentName={renderOpponentName}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
