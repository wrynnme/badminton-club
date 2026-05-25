"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntityLink } from "@/components/tournament/stats/entity-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type HeadToHeadRow = {
  id: string;
  name: string;
  color?: string | null;
  played: number;
  wins: number;
  losses: number;
  draws: number;
};

/**
 * Default link wrapper for the name column. Caller passes `entityType` (pair
 * for pair/player views, team for team view, player for the player-view
 * partner-breakdown table — caller can also override entirely via `renderName`).
 */
export type RowNameRenderer = (name: string, id: string) => ReactNode;

/**
 * Generic "small h2h table" with a 5-column layout (label / P / W / L / D).
 * Used by:
 *  - pair view (h2h vs opponent pairs) — entityType="pair"
 *  - player view (h2h vs opponent pairs) — entityType="pair"
 *  - player view (partner breakdown) — entityType="player"
 *  - team view (h2h vs opponent teams) — entityType="team"
 *
 * `nameLabel` defaults to "คู่แข่ง". Pass `color` per row to render a
 * left-aligned color dot (team-style); otherwise the name renders plain.
 *
 * Provide `entityType` to wrap row names in {@link EntityLink}; omit (or pass
 * a no-op `renderName`) to render unwrapped text.
 */
export function HeadToHeadTable({
  title,
  nameLabel = "คู่แข่ง",
  rows,
  entityType,
  renderName,
}: {
  title: string;
  nameLabel?: string;
  rows: HeadToHeadRow[];
  entityType?: "pair" | "team" | "player" | "division";
  renderName?: RowNameRenderer;
}) {
  const renderRowName: RowNameRenderer =
    renderName ??
    (entityType
      ? (name, id) => (
          <EntityLink entityType={entityType} entityId={id}>
            {name}
          </EntityLink>
        )
      : (name) => name);

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="text-muted-foreground font-medium text-xs h-9">
                {nameLabel}
              </TableHead>
              <TableHead className="text-right text-muted-foreground font-medium text-xs h-9 w-12">
                แมตช์
              </TableHead>
              <TableHead className="text-right text-muted-foreground font-medium text-xs h-9 w-12">
                ชนะ
              </TableHead>
              <TableHead className="text-right text-muted-foreground font-medium text-xs h-9 w-12">
                แพ้
              </TableHead>
              <TableHead className="text-right text-muted-foreground font-medium text-xs h-9 w-12">
                เสมอ
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="py-2.5 whitespace-normal max-w-0 w-full">
                  <span className="flex items-center gap-1.5 min-w-0">
                    {row.color && (
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: row.color }}
                      />
                    )}
                    <span className="truncate min-w-0 text-sm">
                      {renderRowName(row.name, row.id)}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm py-2.5">
                  {row.played}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm py-2.5 text-green-600 dark:text-green-400">
                  {row.wins}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm py-2.5 text-red-600 dark:text-red-400">
                  {row.losses}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm py-2.5 text-yellow-600 dark:text-yellow-400">
                  {row.draws}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
