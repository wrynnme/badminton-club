import { format } from "date-fns";
import { getLocale, getTranslations } from "next-intl/server";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Level, SeriesMember } from "@/lib/types";
import type { SeriesStatsData } from "@/lib/club/series-stats";

/**
 * Format win-rate 0..1 as a percentage string ("57%"). Local copy of the
 * tournament domain's `formatWinRate` (`src/lib/tournament/result-display.ts`)
 * — the club domain does not otherwise import from `lib/tournament`, and a
 * one-line formatter isn't worth introducing that cross-domain coupling for.
 */
function formatWinRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

type Props = {
  members: SeriesMember[];
  levels: Level[];
  stats: SeriesStatsData;
};

/**
 * Read-only cross-session member stats (ADR 0002 P4, decision #9 — "stats"
 * tab on the series home page). A server component: this tab has no
 * interactivity (no buttons/actions per decision #9), so it ships zero client
 * JS. All aggregation happens in `computeSeriesStats` (`series-stats.ts`) —
 * this component only merges in zero-appearance registry members, formats,
 * and renders.
 */
export async function SeriesStatsView({ members, levels, stats }: Props) {
  const t = await getTranslations("club.seriesStats");
  const locale = await getLocale();

  const levelLabelById = new Map(levels.map((l) => [l.id, l.label]));

  // Union of every registered member — including ones with zero appearances
  // (no matching row in stats.memberStats), which sort to the bottom via the
  // matchesPlayed-desc sort below.
  const rows = members
    .map((m) => {
      const s = stats.memberStats.get(m.id);
      return {
        memberId: m.id,
        name: m.canonical_name,
        levelLabel: m.default_level_id ? (levelLabelById.get(m.default_level_id) ?? "—") : "—",
        sessionsAttended: s?.sessionsAttended ?? 0,
        matchesPlayed: s?.matchesPlayed ?? 0,
        wins: s?.wins ?? 0,
        losses: s?.losses ?? 0,
        lastPlayDate: s?.lastPlayDate ?? null,
      };
    })
    .sort((a, b) => b.matchesPlayed - a.matchesPlayed || a.name.localeCompare(b.name, "th"));

  if (stats.totalMatches === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">{t("empty")}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{t("totalSessionsLabel", { count: stats.totalSessions })}</Badge>
        <Badge variant="outline">{t("totalMatchesLabel", { count: stats.totalMatches })}</Badge>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t("tableTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colName")}</TableHead>
                <TableHead className="text-center">{t("colLevel")}</TableHead>
                <TableHead className="text-center">{t("colSessions")}</TableHead>
                <TableHead className="text-center">{t("colMatches")}</TableHead>
                <TableHead className="text-center">{t("colRecord")}</TableHead>
                <TableHead className="text-center">{t("colWinRate")}</TableHead>
                <TableHead className="text-center whitespace-nowrap">{t("colLastPlayed")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const winRate = r.matchesPlayed > 0 ? r.wins / r.matchesPlayed : 0;
                return (
                  <TableRow key={r.memberId}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-center text-muted-foreground">{r.levelLabel}</TableCell>
                    <TableCell className="text-center tabular-nums">{r.sessionsAttended}</TableCell>
                    <TableCell className="text-center tabular-nums font-semibold">{r.matchesPlayed}</TableCell>
                    <TableCell className="text-center tabular-nums text-muted-foreground">
                      {r.matchesPlayed > 0 ? `${r.wins}-${r.losses}` : "—"}
                    </TableCell>
                    <TableCell className="text-center tabular-nums text-muted-foreground">
                      {r.matchesPlayed > 0 ? formatWinRate(winRate) : "—"}
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground text-xs whitespace-nowrap">
                      {r.lastPlayDate
                        ? format(new Date(r.lastPlayDate), "d MMM yyyy", { locale: dateFnsLocaleOf(locale) })
                        : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
