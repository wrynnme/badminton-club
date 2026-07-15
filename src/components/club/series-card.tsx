import Link from "next/link";
import { format } from "date-fns";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";

export type SeriesCardData = {
  id: string;
  name: string;
  /** The series' active session (decision #3), when it resolves to a real row. */
  activeSession: { venue: string; play_date: string } | null;
  sessionCount: number;
  memberCount: number;
};

/** Named ก๊วนถาวร summary card for `/clubs` (ADR 0002 decision #1) — links to the series home. */
export async function SeriesCard({ series }: { series: SeriesCardData }) {
  const t = await getTranslations("club");
  const locale = await getLocale();

  return (
    <Link href={`/clubs/${series.id}`}>
      <Card className="hover:shadow-md transition">
        <CardHeader>
          <CardTitle className="flex items-start justify-between gap-2">
            <span className="line-clamp-1">{series.name}</span>
            {series.activeSession && <Badge variant="secondary">{t("series.activeSessionBadge")}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {series.activeSession ? (
            <>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <span className="line-clamp-1">{series.activeSession.venue}</span>
              </div>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4" />
                <span>
                  {format(new Date(series.activeSession.play_date), "d MMM", {
                    locale: dateFnsLocaleOf(locale),
                  })}
                </span>
              </div>
            </>
          ) : (
            <p>{t("series.noActiveSession")}</p>
          )}
          <div className="flex items-center gap-4">
            <span>{t("series.sessionCountLabel", { count: series.sessionCount })}</span>
            <span className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              {t("series.memberCountLabel", { count: series.memberCount })}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
