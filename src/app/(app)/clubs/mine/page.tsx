import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getTranslations } from "next-intl/server";
import { MySessionGroups, type MySessionGroup, type MySessionRow } from "@/components/club/my-session-groups";
import { ownerOrAdminOrFilter } from "@/lib/owner-scope";

export const dynamic = "force-dynamic";

type ClubRow = {
  id: string;
  name: string;
  venue: string;
  play_date: string;
  start_time: string;
  end_time: string;
  max_players: number;
  series_id: string | null;
  series: { id: string; name: string; is_adhoc: boolean; active_session_id: string | null } | null;
};

/**
 * `/clubs/mine` — every รอบตี this user owns or co-admins, grouped per ก๊วน
 * (grilled 2026-07-16; replaces the old flat date-sorted grid). เฉพาะกิจ and
 * legacy no-series rows pool into one bucket at the end.
 */
export default async function MyClubsPage() {
  const sb = await createAdminClient();
  const session = await getSession();
  const canCreate = !!session && !session.isGuest;

  let clubs: ClubRow[] = [];
  if (session && !session.isGuest) {
    const { data: adminRows } = await sb
      .from("club_admins")
      .select("club_id")
      .eq("user_id", session.profileId);
    const adminClubIds = (adminRows ?? []).map((r) => r.club_id);
    const { data } = await sb
      .from("clubs")
      .select(
        "id, name, venue, play_date, start_time, end_time, max_players, series_id, series:club_series!series_id(id, name, is_adhoc, active_session_id)",
      )
      .or(ownerOrAdminOrFilter(session.profileId, adminClubIds))
      .order("play_date", { ascending: false });
    clubs = (data ?? []) as unknown as ClubRow[];
  }

  const clubIds = clubs.map((c) => c.id);
  const countMap = new Map<string, number>();
  if (clubIds.length) {
    const { data: counts } = await sb
      .from("club_players")
      .select("club_id")
      .in("club_id", clubIds);
    for (const r of counts ?? []) {
      countMap.set(r.club_id, (countMap.get(r.club_id) ?? 0) + 1);
    }
  }

  // Group per named ก๊วน; เฉพาะกิจ + legacy no-series rows pool into one
  // trailing bucket. Rows arrive play_date-desc from the query, so each
  // group's first row is its newest — groups sort by that.
  const toRow = (c: ClubRow): MySessionRow => ({
    clubId: c.id,
    seriesId: c.series_id,
    sessionName: c.name,
    venue: c.venue,
    play_date: c.play_date,
    start_time: c.start_time,
    end_time: c.end_time,
    joined: countMap.get(c.id) ?? 0,
    max: c.max_players,
    isActive: !!c.series && c.series.active_session_id === c.id,
  });

  const namedGroups = new Map<string, MySessionGroup>();
  const adhocRows: MySessionRow[] = [];
  for (const c of clubs) {
    if (c.series && !c.series.is_adhoc) {
      const g = namedGroups.get(c.series.id) ?? { key: c.series.id, seriesName: c.series.name, sessions: [] };
      g.sessions.push(toRow(c));
      namedGroups.set(c.series.id, g);
    } else {
      adhocRows.push(toRow(c));
    }
  }
  const groups: MySessionGroup[] = [...namedGroups.values()].sort((a, b) =>
    b.sessions[0].play_date.localeCompare(a.sessions[0].play_date),
  );
  if (adhocRows.length) groups.push({ key: "adhoc", seriesName: null, sessions: adhocRows });

  const t = await getTranslations("club");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("page.myListHeading")}</h1>
        {canCreate && (
          <Link href="/clubs/new">
            <Button>{t("page.createButton")}</Button>
          </Link>
        )}
      </div>

      {!groups.length ? (
        <p className="text-muted-foreground">
          {canCreate ? t("page.emptyWithCreate") : t("page.emptyNoCreate")}
        </p>
      ) : (
        <MySessionGroups groups={groups} />
      )}
    </div>
  );
}
