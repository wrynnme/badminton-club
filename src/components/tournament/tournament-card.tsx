import Link from "next/link";
import { format } from "date-fns";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TOURNAMENT_STATUS_BADGE } from "@/lib/tournament/status";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";
import type { Tournament } from "@/lib/types";

/** Tournament summary card shared by `/tournaments` and `/tournaments/mine`. */
export async function TournamentCard({ tournament }: { tournament: Tournament }) {
  const t = await getTranslations("tournament");
  const locale = await getLocale();

  const formatLabel: Record<string, string> = {
    group_only: t("page.formatGroupOnly"),
    group_knockout: t("page.formatGroupKnockout"),
    knockout_only: t("page.formatKnockoutOnly"),
  };

  return (
    <Link href={`/tournaments/${tournament.id}`}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-snug">{tournament.name}</CardTitle>
            <Badge variant={TOURNAMENT_STATUS_BADGE[tournament.status]} className="shrink-0">
              {t(`tournamentStatus.${tournament.status}`)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          {tournament.venue && <p>📍 {tournament.venue}</p>}
          {tournament.start_date && (
            <p>📅 {format(new Date(tournament.start_date), "d MMM yyyy", { locale: dateFnsLocaleOf(locale) })}</p>
          )}
          <p>🏆 {formatLabel[tournament.format]} · {t("page.listTeamCount", { count: tournament.team_count })}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
