import Link from "next/link";
import { format } from "date-fns";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarDays, ChevronDown, MapPin, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";

import type { MySessionGroup } from "@/lib/club/my-sessions";

/**
 * `/clubs/mine` grouped view (grilled 2026-07-16): one collapsible group per
 * ก๊วน (native <details>, default-open — no client JS), rows = its รอบตี
 * newest-first with an active badge. เฉพาะกิจ / legacy no-series rows pool
 * into one bucket at the end.
 */
export async function MySessionGroups({ groups }: { groups: MySessionGroup[] }) {
  const t = await getTranslations("club");
  const locale = await getLocale();

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <details key={g.key} open className="group rounded-xl border bg-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="font-semibold line-clamp-1">
              {g.seriesName ?? t("series.adhocHeading")}
            </span>
            <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
              {t("series.sessionCountLabel", { count: g.sessions.length })}
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </span>
          </summary>
          <div className="divide-y border-t">
            {g.sessions.map((s) => (
              <Link
                key={s.clubId}
                href={s.seriesId ? `/clubs/${s.seriesId}/s/${s.clubId}` : `/clubs/${s.clubId}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-muted/50 transition"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex items-center gap-1 font-medium">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    {format(new Date(s.play_date), "EEE d MMM yy", { locale: dateFnsLocaleOf(locale) })}{" "}
                    {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                  </span>
                  {/* เฉพาะกิจ rows carry their own name; a named series' rows repeat it — skip */}
                  {g.seriesName === null && <span className="line-clamp-1">{s.sessionName}</span>}
                  {s.isActive && <Badge variant="secondary">{t("series.activeSessionBadge")}</Badge>}
                  {!s.isManaged && <Badge variant="outline">{t("series.joinedBadge")}</Badge>}
                </span>
                <span className="flex shrink-0 items-center gap-3 text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    {s.joined}/{s.max}
                  </span>
                  <span className="flex max-w-40 items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    <span className="line-clamp-1">{s.venue}</span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
