import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { format } from "date-fns";
import { CalendarDays, MapPin } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { assertCanManageSeries } from "@/lib/club/series-permissions";
import type { ClubSeries } from "@/lib/types";

/**
 * Series home SHELL (ADR 0002 P2-B, decision #1) — placeholder page for a
 * named ก๊วนถาวร (`club_series` row): header + active session + session
 * history. The members / settings / จัดก๊วน tabs land in the next P2 slice —
 * this shell is deliberately self-contained (owns its own auth gate + fetch,
 * mirroring `ClubSessionView`) so it's easy to extend into a full tab layout
 * later without threading extra props through the dispatcher.
 */
export async function SeriesHome({ seriesId }: { seriesId: string }) {
  const sb = await createAdminClient();
  const session = await getSession();

  // Series are owner/co-admin only — same gate shape as ClubSessionView
  // (login redirect preserves redirectTo; logged-in non-manager → club list).
  if (!session) {
    redirect(`/?auth_error=login_required&redirectTo=${encodeURIComponent(`/clubs/${seriesId}`)}`);
  }

  const canManage = await assertCanManageSeries(sb, seriesId, session.profileId);
  if (!canManage) redirect("/clubs");

  const { data: seriesRow } = await sb.from("club_series").select("*").eq("id", seriesId).maybeSingle();
  if (!seriesRow) notFound();
  const series = seriesRow as ClubSeries;

  const { data: sessionsData } = await sb
    .from("clubs")
    .select("id, name, venue, play_date")
    .eq("series_id", seriesId)
    .order("play_date", { ascending: false })
    .order("created_at", { ascending: false });
  const sessions = sessionsData ?? [];
  const activeSession = sessions.find((s) => s.id === series.active_session_id) ?? null;

  const t = await getTranslations("club");
  const locale = await getLocale();

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-2">
        <h1 className="text-2xl font-bold">{series.name}</h1>
        {series.archived_at && <Badge variant="outline">{t("series.archivedBadge")}</Badge>}
      </div>

      <section className="space-y-2">
        {activeSession ? (
          <Link href={`/clubs/${series.id}/s/${activeSession.id}`}>
            <Card className="hover:shadow-md transition">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span className="line-clamp-1">{activeSession.name}</span>
                  <Badge variant="secondary">{t("series.activeSessionBadge")}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  <span className="line-clamp-1">{activeSession.venue}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4" />
                  <span>
                    {format(new Date(activeSession.play_date), "EEE d MMM yyyy", {
                      locale: dateFnsLocaleOf(locale),
                    })}
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ) : (
          <Card>
            <CardContent className="pt-4 text-sm text-muted-foreground">{t("series.noActiveSession")}</CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">{t("series.historyHeading")}</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("series.noSessions")}</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <Link key={s.id} href={`/clubs/${series.id}/s/${s.id}`}>
                <Card className="hover:shadow-md transition">
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <span className="font-medium line-clamp-1">{s.name}</span>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="h-4 w-4" />
                        {format(new Date(s.play_date), "d MMM yyyy", { locale: dateFnsLocaleOf(locale) })}
                      </span>
                      <span className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        <span className="line-clamp-1">{s.venue}</span>
                      </span>
                      {s.id === series.active_session_id && (
                        <Badge variant="secondary">{t("series.activeSessionBadge")}</Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* สมาชิก / ตั้งค่า / จัดก๊วน tabs land in the next P2 slice (ADR 0002). */}
    </div>
  );
}
