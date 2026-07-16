import Link from "next/link";
import { format } from "date-fns";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";

export type UpcomingSessionEntry = {
  /** null = legacy no-series row — link via the dispatcher redirect. */
  seriesId: string | null;
  sessionId: string;
  clubName: string;
  venue: string;
  play_date: string;
  start_time: string;
  end_time: string;
  isToday: boolean;
};

/**
 * Fast-path hero at the top of `/clubs` (grilled 2026-07-16): every active
 * รอบตี playing today or later — named ก๊วน and เฉพาะกิจ alike — as a
 * full-width card whose CTA jumps straight into the session (1 click, vs the
 * old series-home detour). Days with nothing scheduled render nothing.
 */
export async function UpcomingSessionHero({ entries }: { entries: UpcomingSessionEntry[] }) {
  if (entries.length === 0) return null;
  const t = await getTranslations("club");
  const locale = await getLocale();

  return (
    <section className="space-y-2">
      <h2 className="font-semibold text-sm text-muted-foreground">{t("page.upcomingHeading")}</h2>
      <div className="space-y-2">
        {entries.map((e) => (
          <Card key={e.sessionId} className={e.isToday ? "border-primary/60" : undefined}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold line-clamp-1">{e.clubName}</span>
                  {e.isToday && <Badge>{t("page.todayBadge")}</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-4 w-4" />
                    {format(new Date(e.play_date), "EEE d MMM", { locale: dateFnsLocaleOf(locale) })}{" "}
                    {e.start_time.slice(0, 5)}–{e.end_time.slice(0, 5)}
                  </span>
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    <span className="line-clamp-1">{e.venue}</span>
                  </span>
                </div>
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Link
                      href={e.seriesId ? `/clubs/${e.seriesId}/s/${e.sessionId}` : `/clubs/${e.sessionId}`}
                      className={`${buttonVariants()} gap-1.5`}
                    >
                      {t("page.enterSession")}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  }
                />
                <TooltipContent>{t("page.enterSessionTip")}</TooltipContent>
              </Tooltip>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
