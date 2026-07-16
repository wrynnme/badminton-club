import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { getLocale, getTranslations } from "next-intl/server";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";
import { SeriesCard, type SeriesCardData } from "@/components/club/series-card";
import { ArchivedSeriesSection, type ArchivedSeriesEntry } from "@/components/club/archived-series-section";
import { UpcomingSessionHero, type UpcomingSessionEntry } from "@/components/club/upcoming-session-hero";
import { MySessionGroups } from "@/components/club/my-session-groups";
import { buildMySessionGroups, type MySessionSourceRow } from "@/lib/club/my-sessions";
import { fetchMySessionRows } from "@/lib/club/my-sessions.server";
import { ownerOrAdminOrFilter } from "@/lib/owner-scope";

export const dynamic = "force-dynamic";

type SeriesRow = {
  id: string;
  name: string;
  is_adhoc: boolean;
  active_session_id: string | null;
};

type SessionRow = {
  id: string;
  series_id: string;
  venue: string;
  play_date: string;
  start_time: string;
  end_time: string;
};

/**
 * `/clubs` — series list (ADR 0002 decision #1). Named ก๊วนถาวร render as full
 * cards on top; below them "รอบตีของฉัน" lists every session the user manages
 * OR plays in (shared builder with /clubs/mine — เฉพาะกิจ rows now live inside
 * that list's trailing bucket instead of their own section, and participant-only
 * rows carry an "เข้าร่วม" badge that opens the session read-only).
 */
export default async function ClubsPage() {
  const sb = await createAdminClient();
  const session = await getSession();
  const canCreate = !!session && !session.isGuest;
  const locale = await getLocale();

  let namedSeries: SeriesCardData[] = [];
  let myRows: MySessionSourceRow[] = [];
  let archivedEntries: ArchivedSeriesEntry[] = [];
  let upcomingEntries: UpcomingSessionEntry[] = [];

  if (session) {
    // Series this user owns, or co-admins via any session (`clubs` row) under it —
    // co-admins are still per-session until P3 lifts them to the series level.
    const { data: adminRows } = await sb
      .from("club_admins")
      .select("club_id")
      .eq("user_id", session.profileId);
    const adminClubIds = (adminRows ?? []).map((r) => r.club_id as string);

    let adminSeriesIds: string[] = [];
    if (adminClubIds.length > 0) {
      const { data: adminClubs } = await sb
        .from("clubs")
        .select("series_id")
        .in("id", adminClubIds)
        .not("series_id", "is", null);
      adminSeriesIds = [...new Set((adminClubs ?? []).map((r) => r.series_id as string))];
    }

    // Visible (non-archived) series + this user's own archived series (decision
    // #13 — owner-only "กู้คืน" section below) in the same wave.
    const [seriesRowsRes, archivedRowsRes, myRowsRes] = await Promise.all([
      sb
        .from("club_series")
        .select("id, name, is_adhoc, active_session_id")
        .is("archived_at", null)
        .or(ownerOrAdminOrFilter(session.profileId, adminSeriesIds)),
      sb
        .from("club_series")
        .select("id, name, archived_at")
        .eq("owner_id", session.profileId)
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false }),
      fetchMySessionRows(sb, session.profileId),
    ]);
    myRows = myRowsRes;
    const seriesList = (seriesRowsRes.data ?? []) as SeriesRow[];
    const seriesIds = seriesList.map((s) => s.id);

    // Every session of every visible series, plus series-level member counts —
    // TWO grouped queries total (never per-card) regardless of how many series.
    let sessions: SessionRow[] = [];
    const memberCountMap = new Map<string, number>();
    if (seriesIds.length > 0) {
      const [sessionsRes, membersRes] = await Promise.all([
        sb
          .from("clubs")
          .select("id, series_id, venue, play_date, start_time, end_time")
          .in("series_id", seriesIds)
          .order("play_date", { ascending: false })
          .order("created_at", { ascending: false }),
        sb.from("series_members").select("series_id").in("series_id", seriesIds),
      ]);
      sessions = (sessionsRes.data ?? []) as SessionRow[];
      for (const r of membersRes.data ?? []) {
        const key = r.series_id as string;
        memberCountMap.set(key, (memberCountMap.get(key) ?? 0) + 1);
      }
    }

    const sessionsBySeriesId = new Map<string, SessionRow[]>();
    for (const s of sessions) {
      const list = sessionsBySeriesId.get(s.series_id) ?? [];
      list.push(s);
      sessionsBySeriesId.set(s.series_id, list);
    }
    // resolveTarget: the series' active session row, else the latest one
    // (sessions are already ordered play_date desc, created_at desc above).
    const resolveTarget = (s: SeriesRow): SessionRow | null => {
      const own = sessionsBySeriesId.get(s.id) ?? [];
      return own.find((c) => c.id === s.active_session_id) ?? own[0] ?? null;
    };

    namedSeries = seriesList
      .filter((s) => !s.is_adhoc)
      .map((s): SeriesCardData => {
        const active = resolveTarget(s);
        return {
          id: s.id,
          name: s.name,
          activeSession: active ? { venue: active.venue, play_date: active.play_date } : null,
          sessionCount: (sessionsBySeriesId.get(s.id) ?? []).length,
          memberCount: memberCountMap.get(s.id) ?? 0,
        };
      })
      .sort((a, b) => (b.activeSession?.play_date ?? "").localeCompare(a.activeSession?.play_date ?? ""));

    // Hero eligibility (grilled 2026-07-16): each series' active/latest รอบตี
    // when it plays today or later — "today" pinned to Asia/Bangkok, not the
    // server's UTC clock, so a 23:00 round doesn't vanish 7 hours early.
    const todayBkk = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
    upcomingEntries = seriesList
      .map((s): UpcomingSessionEntry | null => {
        const target = resolveTarget(s);
        if (!target || target.play_date < todayBkk) return null;
        return {
          seriesId: s.id,
          sessionId: target.id,
          clubName: s.name,
          venue: target.venue,
          play_date: target.play_date,
          start_time: target.start_time,
          end_time: target.end_time,
          isToday: target.play_date === todayBkk,
        };
      })
      .filter((e): e is UpcomingSessionEntry => e !== null)
      .sort((a, b) => a.play_date.localeCompare(b.play_date));

    archivedEntries = ((archivedRowsRes.data ?? []) as { id: string; name: string; archived_at: string }[]).map(
      (row): ArchivedSeriesEntry => ({
        seriesId: row.id,
        name: row.name,
        archivedDateLabel: format(new Date(row.archived_at), "d MMM yyyy", { locale: dateFnsLocaleOf(locale) }),
      }),
    );
  }

  const t = await getTranslations("club");
  const myGroups = buildMySessionGroups(myRows);
  const hasAny = namedSeries.length > 0 || myGroups.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("page.listHeading")}</h1>
        {canCreate && (
          <Link href="/clubs/new">
            <Button>{t("page.createButton")}</Button>
          </Link>
        )}
      </div>

      {session?.isGuest && (
        <p className="text-xs text-muted-foreground">{t("page.guestHint")}</p>
      )}

      <UpcomingSessionHero entries={upcomingEntries} />

      {!hasAny ? (
        <p className="text-muted-foreground">
          {canCreate ? t("page.emptyWithCreate") : t("page.emptyNoCreate")}
        </p>
      ) : (
        <>
          {namedSeries.length > 0 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {namedSeries.map((s) => (
                <SeriesCard key={s.id} series={s} />
              ))}
            </div>
          )}

          {myGroups.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-semibold text-sm text-muted-foreground">{t("page.myListHeading")}</h2>
              <MySessionGroups groups={myGroups} />
            </section>
          )}
        </>
      )}

      {archivedEntries.length > 0 && (
        <section>
          <ArchivedSeriesSection entries={archivedEntries} />
        </section>
      )}
    </div>
  );
}
