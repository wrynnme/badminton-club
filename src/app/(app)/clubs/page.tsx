import Link from "next/link";
import { Archive } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";
import { SeriesCard, type SeriesCardData } from "@/components/club/series-card";
import { UpcomingSessionHero, type UpcomingSessionEntry } from "@/components/club/upcoming-session-hero";
import { MySessionGroups } from "@/components/club/my-session-groups";
import { buildMySessionGroups, type MySessionSourceRow } from "@/lib/club/my-sessions";
import { fetchMySessionRows } from "@/lib/club/my-sessions.server";
import { isSessionDone, liveSessions, todayBangkok } from "@/lib/club/session-done";
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
  closed_at: string | null;
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
  // "today" pinned to Asia/Bangkok, not the server's UTC clock, so a 23:00
  // round doesn't vanish 7 hours early (hero filter + done-state derivation).
  const todayBkk = todayBangkok();

  let namedSeries: SeriesCardData[] = [];
  let myRows: MySessionSourceRow[] = [];
  let archivedCount = 0;
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

    // Visible (non-archived) series + a COUNT of the user's own archived series
    // (the list itself moved to /clubs/archive 2026-07-16; here we only need to
    // know whether to show the link) in the same wave.
    const [seriesRowsRes, archivedCountRes, myRowsRes] = await Promise.all([
      sb
        .from("club_series")
        .select("id, name, is_adhoc, active_session_id")
        .is("archived_at", null)
        .or(ownerOrAdminOrFilter(session.profileId, adminSeriesIds)),
      session.isGuest
        ? Promise.resolve({ count: 0 })
        : sb
            .from("club_series")
            .select("id", { count: "exact", head: true })
            .eq("owner_id", session.profileId)
            .not("archived_at", "is", null),
      session.isGuest
        ? Promise.resolve([] as MySessionSourceRow[])
        : fetchMySessionRows(sb, session.profileId, adminClubIds),
    ]);
    myRows = myRowsRes;
    archivedCount = archivedCountRes.count ?? 0;
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
          .select("id, series_id, venue, play_date, start_time, end_time, closed_at")
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
          // Pointer stays on a closed round (decision 2026-07-16) — the card
          // keeps showing it but swaps the badge to "จบแล้ว".
          activeSessionDone: active ? isSessionDone(active, todayBkk) : false,
          sessionCount: (sessionsBySeriesId.get(s.id) ?? []).length,
          memberCount: memberCountMap.get(s.id) ?? 0,
        };
      })
      .sort((a, b) => (b.activeSession?.play_date ?? "").localeCompare(a.activeSession?.play_date ?? ""));

    // Hero eligibility (grilled 2026-07-16): each series' active/latest รอบตี
    // when it plays today or later AND isn't closed ("ปิดรอบ").
    upcomingEntries = seriesList
      .map((s): UpcomingSessionEntry | null => {
        const target = resolveTarget(s);
        if (!target || isSessionDone(target, todayBkk)) return null;
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
      .filter((e): e is UpcomingSessionEntry => e !== null);

    // Participant-only rounds deserve the same fast path — a member's "today's
    // round" is exactly what they came to tap. Managed rows are already covered
    // by the series pass above (dedupe by session id).
    const seen = new Set(upcomingEntries.map((e) => e.sessionId));
    for (const r of myRows) {
      if (r.managed || seen.has(r.id) || isSessionDone(r, todayBkk)) continue;
      seen.add(r.id);
      upcomingEntries.push({
        seriesId: r.series_id,
        sessionId: r.id,
        clubName: r.series?.name ?? r.name,
        venue: r.venue,
        play_date: r.play_date,
        start_time: r.start_time,
        end_time: r.end_time,
        isToday: r.play_date === todayBkk,
      });
    }
    upcomingEntries.sort((a, b) => a.play_date.localeCompare(b.play_date));
  }

  const t = await getTranslations("club");
  // /clubs shows only live rounds (decision 2026-07-16) — done rounds (closed
  // or past play_date) live on /clubs/mine, which renders the unfiltered list.
  const liveRows = liveSessions(myRows, todayBkk);
  const myGroups = buildMySessionGroups(liveRows, todayBkk);
  const hasAny = namedSeries.length > 0 || myGroups.length > 0;
  // Flow Step 4: a pure participant (plays in LIVE rounds, manages none) still
  // CAN create — but it shouldn't be the loudest thing on their page. Built on
  // hasAny (same live-filtered basis) so a player whose rounds all ended counts
  // as first-run again (two-doors + default button), never a mix of both.
  const playerOnly = hasAny && namedSeries.length === 0 && liveRows.every((r) => !r.managed);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("page.listHeading")}</h1>
        {canCreate && (
          <Link href="/clubs/new">
            <Button variant={playerOnly ? "outline" : "default"}>{t("page.createButton")}</Button>
          </Link>
        )}
      </div>

      {session?.isGuest && (
        <p className="text-xs text-muted-foreground">{t("page.guestHint")}</p>
      )}

      <UpcomingSessionHero entries={upcomingEntries} />

      {!hasAny ? (
        canCreate ? (
          /* First-run, two doors (flow Step 3, 2026-07-21): half of new users
             were INVITED — the old single "create your first club" line left
             them with no path. Server-rendered, no client JS. */
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardContent className="space-y-2">
                <p className="font-semibold">{t("firstRun.createTitle")}</p>
                <p className="text-sm text-muted-foreground">{t("firstRun.createDesc")}</p>
                <Link href="/clubs/new" className="inline-block pt-1">
                  <Button size="sm">{t("page.createButton")}</Button>
                </Link>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-2">
                <p className="font-semibold">{t("firstRun.joinTitle")}</p>
                <p className="text-sm text-muted-foreground">{t("firstRun.joinDesc")}</p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <p className="text-muted-foreground">{t("page.emptyNoCreate")}</p>
        )
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

      {archivedCount > 0 && (
        <div>
          <Link
            href="/clubs/archive"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <Archive className="h-4 w-4" />
            {t("series.archivedLink", { count: archivedCount })}
          </Link>
        </div>
      )}
    </div>
  );
}
