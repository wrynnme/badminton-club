/**
 * my-sessions.server.ts — fetch every session the user manages or plays in
 * (see my-sessions.ts for the pure grouping). One clubs query via a combined
 * .or() filter with an embedded club_players(count); managed-ness derived per
 * row from the three sources: owner, club co-admin (`club_admins`), series
 * co-admin (`series_admins`, ADR 0002 P3 — previously missing from
 * /clubs/mine, which only knew the first two).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { ownerOrAdminOrFilter } from "@/lib/owner-scope";
import type { MySessionSourceRow } from "@/lib/club/my-sessions";

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

type ClubRow = Omit<MySessionSourceRow, "managed" | "joined"> & {
  owner_id: string;
  club_players: { count: number }[];
};

/**
 * `knownAdminClubIds` lets a caller that already fetched the user's
 * `club_admins` rows (e.g. `/clubs`) skip re-querying them here.
 */
export async function fetchMySessionRows(
  sb: AdminClient,
  profileId: string,
  knownAdminClubIds?: string[],
): Promise<MySessionSourceRow[]> {
  const [adminClubIdList, seriesAdminRes, playerRes] = await Promise.all([
    knownAdminClubIds ??
      sb
        .from("club_admins")
        .select("club_id")
        .eq("user_id", profileId)
        .then((r) => (r.data ?? []).map((x) => x.club_id as string)),
    sb.from("series_admins").select("series_id").eq("user_id", profileId),
    sb.from("club_players").select("club_id").eq("profile_id", profileId),
  ]);
  const adminClubIds = new Set(adminClubIdList);
  const adminSeriesIds = new Set((seriesAdminRes.data ?? []).map((r) => r.series_id as string));
  const playerClubIds = new Set((playerRes.data ?? []).map((r) => r.club_id as string));

  const idList = [...new Set([...adminClubIds, ...playerClubIds])];
  const orParts = [ownerOrAdminOrFilter(profileId, idList)];
  if (adminSeriesIds.size > 0) orParts.push(`series_id.in.(${[...adminSeriesIds].join(",")})`);

  // No .order() — buildMySessionGroups re-sorts rows newest-first itself.
  const { data } = await sb
    .from("clubs")
    .select(
      "id, owner_id, name, venue, play_date, start_time, end_time, max_players, series_id, series:club_series!series_id(id, name, is_adhoc, active_session_id), club_players(count)",
    )
    .or(orParts.join(","));
  const clubs = (data ?? []) as unknown as ClubRow[];

  // Managed wins over participant — a manager who also plays gets no badge.
  return clubs.map(({ owner_id, club_players, ...c }) => ({
    ...c,
    managed:
      owner_id === profileId ||
      adminClubIds.has(c.id) ||
      (!!c.series_id && adminSeriesIds.has(c.series_id)),
    joined: club_players?.[0]?.count ?? 0,
  }));
}
