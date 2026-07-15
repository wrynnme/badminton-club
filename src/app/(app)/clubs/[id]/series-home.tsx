import Link from "next/link";
import { redirect } from "next/navigation";
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
import { SessionDefaultsEditor } from "@/components/club/session-defaults-editor";
import { SeriesDangerZone } from "@/components/club/series-danger-zone";
import { SeriesCoAdminControls } from "@/components/club/series-co-admin-controls";
import { ClubLinkControls } from "@/components/club/club-link-controls";
import { parseSessionDefaults } from "@/lib/club/session-defaults";
import { resolveJoinToken, resolveLineGroupId } from "@/lib/club/series.server";
import type { SeriesAdmin } from "@/lib/actions/club-series";
import type { ClubLinkPoolRequest, ClubSeries, Level, SeriesMember, SeriesPartnerPair } from "@/lib/types";

/**
 * Series home (ADR 0002 P2-C1/C2) — tabbed page for a named ก๊วนถาวร
 * (`club_series` row): ภาพรวม (จัดก๊วน + active session + ประวัตินัด) ·
 * สมาชิก (member registry + คู่ประจำ) · ตั้งค่า (session defaults editor +
 * LINE link pool + rename/archive/delete danger zone — moved off the
 * per-session settings tab in C2). Owns its own auth gate (mirrors
 * `ClubSessionView`); the series row itself comes from the dispatcher
 * (`page.tsx`), which already fetched it to route here.
 */
export async function SeriesHome({ series }: { series: ClubSeries }) {
  const sb = await createAdminClient();
  const session = await getSession();

  // Series are owner/co-admin only — same gate shape as ClubSessionView
  // (login redirect preserves redirectTo; logged-in non-manager → club list).
  // The owner check runs against the row we already hold; only non-owners pay
  // for assertCanManageSeries' co-admin walk.
  if (!session) {
    redirect(`/?auth_error=login_required&redirectTo=${encodeURIComponent(`/clubs/${series.id}`)}`);
  }

  const canManage =
    session.profileId === series.owner_id ||
    (await assertCanManageSeries(sb, series.id, session.profileId));
  if (!canManage) redirect("/clubs");

  const seriesId = series.id;
  const [sessionsRes, membersRes, pairsRes, levelsRes, playerCountsRes, seriesAdminsRes] = await Promise.all([
    sb
      .from("clubs")
      .select("id, name, venue, play_date, created_at, join_token, line_group_id")
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
    // ADR 0002 P3 — series-level co-admins (owner-only settings section below).
    // Fetched unconditionally alongside everything else (mirrors the club_admins
    // fetch in ClubSessionView) — cheap even when the viewer isn't the owner.
    sb
      .from("series_admins")
      .select("series_id, user_id, added_by, added_at, profile:profiles!series_admins_user_id_fkey(display_name, line_user_id)")
      .eq("series_id", seriesId)
      .order("added_at", { ascending: true }),
  ]);

  const sessions = sessionsRes.data ?? [];
  const members = (membersRes.data ?? []) as SeriesMember[];
  const pairs = (pairsRes.data ?? []) as SeriesPartnerPair[];
  const levels = (levelsRes.data ?? []) as Level[];

  type SeriesAdminRow = {
    series_id: string;
    user_id: string;
    added_by: string | null;
    added_at: string;
    profile: { display_name: string | null; line_user_id: string | null } | null;
  };
  const seriesAdmins: SeriesAdmin[] = ((seriesAdminsRes.data ?? []) as unknown as SeriesAdminRow[]).map((r) => ({
    series_id: r.series_id,
    user_id: r.user_id,
    display_name: r.profile?.display_name ?? null,
    line_user_id: r.profile?.line_user_id ?? null,
    added_by: r.added_by,
    added_at: r.added_at,
  }));

  const playerCountByClubId = new Map<string, number>();
  for (const row of playerCountsRes.data ?? []) {
    const clubId = row.club_id as string;
    playerCountByClubId.set(clubId, (playerCountByClubId.get(clubId) ?? 0) + 1);
  }

  const activeSession = sessions.find((s) => s.id === series.active_session_id) ?? null;
  const isOwner = session.profileId === series.owner_id;

  // LINE link section (pool UI moved here from the session settings tab) — powered
  // by the active session, falling back to the latest session when the series has
  // no active pointer yet. Null only when the series has zero sessions (rare edge —
  // createClubSeriesAction always opens a first session, so this only happens if
  // every session was since deleted).
  const linkSessionClub = activeSession ?? sessions[0] ?? null;

  let pendingLinkRequests: ClubLinkPoolRequest[] = [];
  let guestPlayers: { id: string; display_name: string }[] = [];
  let resolvedJoinToken: string | null = null;
  let resolvedLineGroupId: string | null = null;

  if (linkSessionClub) {
    const [linkReqRes, guestRes] = await Promise.all([
      sb
        .from("club_link_requests")
        .select("id, profile:profiles!profile_id(id, display_name, picture_url)")
        .eq("series_id", series.id)
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      sb
        .from("club_players")
        .select("id, display_name")
        .eq("club_id", linkSessionClub.id)
        .is("profile_id", null),
    ]);

    type LinkReqRow = {
      id: string;
      profile: { id: string; display_name: string; picture_url: string | null } | null;
    };
    const rawLinkReqs = ((linkReqRes.data ?? []) as unknown as LinkReqRow[]).filter((r) => r.profile);
    // decision #4 member badge — derived from the members list already fetched
    // above instead of a second series_members round-trip.
    const memberNameByProfileId = new Map(
      members.filter((m) => m.profile_id).map((m) => [m.profile_id as string, m.canonical_name]),
    );
    pendingLinkRequests = rawLinkReqs.map((r) => ({
      id: r.id,
      profile: { id: r.profile!.id, display_name: r.profile!.display_name, picture_url: r.profile!.picture_url },
      member: memberNameByProfileId.has(r.profile!.id)
        ? { canonicalName: memberNameByProfileId.get(r.profile!.id)! }
        : null,
    }));

    guestPlayers = (guestRes.data ?? []).map((p) => ({
      id: p.id as string,
      display_name: p.display_name as string,
    }));

    // Legacy per-session binding columns came along on the wave-1 sessions
    // select — no extra clubs round-trip needed for the resolve fallback.
    resolvedJoinToken = resolveJoinToken(series, { join_token: linkSessionClub.join_token ?? null });
    resolvedLineGroupId = resolveLineGroupId(series, { line_group_id: linkSessionClub.line_group_id ?? null });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

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

  const settingsTab = (
    <div className="space-y-6">
      <SessionDefaultsEditor
        key={JSON.stringify(series.session_defaults)}
        seriesId={series.id}
        initial={parseSessionDefaults(series.session_defaults)}
        activeSessionId={activeSession?.id ?? null}
      />

      {linkSessionClub ? (
        <ClubLinkControls
          clubId={linkSessionClub.id}
          joinToken={resolvedJoinToken}
          appUrl={appUrl}
          pendingRequests={pendingLinkRequests}
          guestPlayers={guestPlayers}
          lineGroupBound={!!resolvedLineGroupId}
        />
      ) : (
        <Card>
          <CardContent className="pt-4 text-sm text-muted-foreground">{t("series.linkNoSessionsHint")}</CardContent>
        </Card>
      )}

      {isOwner && <SeriesCoAdminControls seriesId={series.id} initialAdmins={seriesAdmins} />}

      {isOwner && (
        <SeriesDangerZone
          seriesId={series.id}
          seriesName={series.name}
          archived={!!series.archived_at}
          hasSessions={sessions.length > 0}
        />
      )}
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-2">
        <h1 className="text-2xl font-bold">{series.name}</h1>
        {series.archived_at && <Badge variant="outline">{t("series.archivedBadge")}</Badge>}
      </div>

      <SeriesTabs overview={overview} members={membersTab} settings={settingsTab} />
    </div>
  );
}
