import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { format } from "date-fns";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { assertCanManageSeries } from "@/lib/club/series-permissions";
import { SeriesTabs } from "@/components/club/series-tabs";
import { SeriesOpenSessionButton } from "@/components/club/series-open-session-button";
import { SeriesSetActiveButton } from "@/components/club/series-set-active-button";
import { SeriesMembersManager } from "@/components/club/series-members-manager";
import { SeriesPartnerPairs } from "@/components/club/series-partner-pairs";
import type { ClubSeries, Level, SeriesMember, SeriesPartnerPair } from "@/lib/types";

/**
 * Series home (ADR 0002 P2-C1) — tabbed page for a named ก๊วนถาวร (`club_series`
 * row): ภาพรวม (จัดก๊วน + active session + ประวัตินัด) · สมาชิก (member
 * registry + คู่ประจำ) · ตั้งค่า (structure only — the session_defaults /
 * rename / archive / LINE-binding editor lands in the next P2 slice, C2).
 * Owns its own auth gate + fetch (mirrors `ClubSessionView`).
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

  const [seriesRes, sessionsRes, membersRes, pairsRes, levelsRes, playerCountsRes] = await Promise.all([
    sb.from("club_series").select("*").eq("id", seriesId).maybeSingle(),
    sb
      .from("clubs")
      .select("id, name, venue, play_date, created_at")
      .eq("series_id", seriesId)
      .order("play_date", { ascending: false })
      .order("created_at", { ascending: false }),
    sb
      .from("series_members")
      .select("*")
      .eq("series_id", seriesId)
      .order("is_regular", { ascending: false })
      .order("canonical_name", { ascending: true }),
    sb.from("series_partner_pairs").select("*").eq("series_id", seriesId),
    // GLOBAL levels only (club_id IS NULL) — the member registry's default
    // level is series-scoped, not tied to any one session's (possibly
    // customized) level set.
    sb.from("levels").select("*").is("club_id", null).order("sort_order", { ascending: true }),
    // Per-session roster size for the history list — ONE grouped query (join
    // on the club_players → clubs FK, filtered by series) instead of one
    // query per session row. Grouped client-side below.
    sb.from("club_players").select("club_id, club:clubs!inner(series_id)").eq("club.series_id", seriesId),
  ]);

  if (!seriesRes.data) notFound();
  const series = seriesRes.data as ClubSeries;
  const sessions = sessionsRes.data ?? [];
  const members = (membersRes.data ?? []) as SeriesMember[];
  const pairs = (pairsRes.data ?? []) as SeriesPartnerPair[];
  const levels = (levelsRes.data ?? []) as Level[];

  const playerCountByClubId = new Map<string, number>();
  for (const row of playerCountsRes.data ?? []) {
    const clubId = row.club_id as string;
    playerCountByClubId.set(clubId, (playerCountByClubId.get(clubId) ?? 0) + 1);
  }

  const activeSession = sessions.find((s) => s.id === series.active_session_id) ?? null;

  const t = await getTranslations("club");
  const locale = await getLocale();

  const overview = (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <SeriesOpenSessionButton seriesId={series.id} archived={!!series.archived_at} />
        <Badge variant="outline">{t("series.sessionCountLabel", { count: sessions.length })}</Badge>
        <Badge variant="outline">{t("series.memberCountLabel", { count: members.length })}</Badge>
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
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  <span>
                    {t("series.playerCountLabel", { count: playerCountByClubId.get(activeSession.id) ?? 0 })}
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
            {sessions.map((s) => {
              const isActive = s.id === series.active_session_id;
              return (
                <Card key={s.id} className="hover:shadow-md transition">
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    {/* Link wraps only the row's text content — the "set active"
                        button below is a sibling, never nested inside an <a>. */}
                    <Link
                      href={`/clubs/${series.id}/s/${s.id}`}
                      className="flex flex-1 min-w-0 flex-wrap items-center gap-3"
                    >
                      <span className="font-medium line-clamp-1">{s.name}</span>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <CalendarDays className="h-4 w-4" />
                        {format(new Date(s.play_date), "d MMM yyyy", { locale: dateFnsLocaleOf(locale) })}
                      </span>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <MapPin className="h-4 w-4" />
                        <span className="line-clamp-1">{s.venue}</span>
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {t("series.playerCountLabel", { count: playerCountByClubId.get(s.id) ?? 0 })}
                      </Badge>
                    </Link>
                    <div className="flex items-center gap-2 shrink-0">
                      {isActive ? (
                        <Badge variant="secondary">{t("series.activeSessionBadge")}</Badge>
                      ) : (
                        <SeriesSetActiveButton seriesId={series.id} clubId={s.id} />
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );

  const membersTab = (
    <div className="space-y-6">
      <SeriesMembersManager seriesId={series.id} members={members} levels={levels} />
      <SeriesPartnerPairs seriesId={series.id} members={members} pairs={pairs} />
    </div>
  );

  // Settings tab: structure only — session_defaults / rename / archive /
  // LINE-binding / join-link / co-admin editor lands in ADR 0002 P2-C2.
  const settingsTab = <div className="space-y-6" />;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-2">
        <h1 className="text-2xl font-bold">{series.name}</h1>
        {series.archived_at && <Badge variant="outline">{t("series.archivedBadge")}</Badge>}
      </div>

      <SeriesTabs overview={overview} members={membersTab} settings={settingsTab} showSettings={canManage} />
    </div>
  );
}
