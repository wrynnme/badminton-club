"use client";

import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EntityLink } from "@/components/tournament/stats/entity-link";
import { buildScoreMatrix } from "@/lib/tournament/score-matrix";
import { RESULT_TEXT_CLASS } from "@/lib/tournament/result-display";
import type { Match } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

export function ScoreMatrix({
  matches,
  competitors,
  unit,
}: {
  matches: Match[];
  competitors: Competitor[];
  unit: "team" | "pair";
}) {
  const grid = useMemo(
    () =>
      buildScoreMatrix(
        matches,
        competitors.map((c) => c.id),
        unit,
      ),
    [matches, competitors, unit],
  );

  if (competitors.length === 0) return null;

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {/* Corner cell */}
          <TableHead className="text-xs text-muted-foreground font-medium h-9 min-w-[8rem] max-w-[12rem]" />
          {competitors.map((c) => (
            <TableHead
              key={c.id}
              className="text-center text-xs font-medium h-9 min-w-[4.5rem]"
              title={c.name}
            >
              <div className="flex flex-col items-center gap-0.5">
                {c.color && (
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: c.color }}
                  />
                )}
                <span className="truncate max-w-[4rem] block">
                  <EntityLink entityType={unit === "pair" ? "pair" : "team"} entityId={c.id}>
                    {c.name}
                  </EntityLink>
                </span>
              </div>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {competitors.map((rowC) => (
          <TableRow key={rowC.id} className="hover:bg-transparent">
            {/* Row header */}
            <TableHead scope="row" className="py-2 max-w-0 w-full font-normal">
              <span className="flex items-center gap-1.5 min-w-0">
                {rowC.color && (
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: rowC.color }}
                  />
                )}
                <span className="truncate min-w-0 text-xs font-medium">
                  <EntityLink
                    entityType={unit === "pair" ? "pair" : "team"}
                    entityId={rowC.id}
                  >
                    {rowC.name}
                  </EntityLink>
                </span>
              </span>
            </TableHead>

            {/* Score cells */}
            {competitors.map((colC) => {
              if (rowC.id === colC.id) {
                // Diagonal
                return (
                  <TableCell
                    key={colC.id}
                    className="text-center text-muted-foreground text-sm py-2"
                  >
                    —
                  </TableCell>
                );
              }

              const cell = grid.get(rowC.id)?.get(colC.id);

              if (!cell || cell.state === "none") {
                return <TableCell key={colC.id} className="text-center py-2" />;
              }

              if (cell.state === "scheduled") {
                return (
                  <TableCell
                    key={colC.id}
                    className="text-center text-muted-foreground py-2"
                  >
                    ·
                  </TableCell>
                );
              }

              // state === "score"
              return (
                <TableCell
                  key={colC.id}
                  className="text-center tabular-nums py-2"
                >
                  <div
                    className={`text-sm leading-tight ${RESULT_TEXT_CLASS[cell.result]}`}
                  >
                    {cell.rowGames}:{cell.colGames}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums leading-tight">
                    {cell.rowPoints}-{cell.colPoints}
                  </div>
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
