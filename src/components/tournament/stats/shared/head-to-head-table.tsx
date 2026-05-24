"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
 * Generic "small h2h table" with a 5-column grid (label / P / W / L / D).
 * Used by:
 *  - pair view (h2h vs opponent pairs)
 *  - player view (h2h vs opponent pairs + partner breakdown)
 *  - team view (h2h vs opponent teams)
 *
 * `nameLabel` defaults to "คู่แข่ง". Pass `color` per row to render a
 * left-aligned color dot (team-style); otherwise the name renders plain.
 */
export function HeadToHeadTable({
  title,
  nameLabel = "คู่แข่ง",
  rows,
}: {
  title: string;
  nameLabel?: string;
  rows: HeadToHeadRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-[1fr_3rem_3rem_3rem_3rem] gap-x-2 px-4 py-2 border-b bg-muted/40 text-xs text-muted-foreground font-medium">
          <span>{nameLabel}</span>
          <span className="text-right">แมตช์</span>
          <span className="text-right">ชนะ</span>
          <span className="text-right">แพ้</span>
          <span className="text-right">เสมอ</span>
        </div>
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[1fr_3rem_3rem_3rem_3rem] gap-x-2 px-4 py-2.5 border-b last:border-b-0 text-sm items-center"
          >
            <span className="flex items-center gap-1.5 truncate min-w-0">
              {row.color && (
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: row.color }}
                />
              )}
              <span className="truncate min-w-0">{row.name}</span>
            </span>
            <span className="text-right tabular-nums">{row.played}</span>
            <span className="text-right tabular-nums text-green-600 dark:text-green-400">
              {row.wins}
            </span>
            <span className="text-right tabular-nums text-red-600 dark:text-red-400">
              {row.losses}
            </span>
            <span className="text-right tabular-nums text-yellow-600 dark:text-yellow-400">
              {row.draws}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
