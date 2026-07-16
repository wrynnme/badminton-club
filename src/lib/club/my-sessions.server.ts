/**
 * my-sessions.server.ts — fetch every session the user manages or plays in
 * (see my-sessions.ts for the pure grouping). One clubs query via a combined
 * .or() filter; managed-ness derived per row from the three sources: owner,
 * club co-admin (`club_admins`), series co-admin (`series_admins`, ADR 0002 P3
 * — previously missing from /clubs/mine, which only knew the first two).
 */

import { createAdminClient } from "@/lib/supabase/server";
import type { MySessionSourceRow } from "@/lib/club/my-sessions";

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

type ClubRow = Omit<MySessionSourceRow, "managed" | "joined"> & { owner_id: string };

export async function fetchMySessionRows(
  sb: AdminClient,
  profileId: string,
): Promise<MySessionSourceRow[]> {
  const [adminRes, seriesAdminRes, playerRes] = await Promise.all([
    sb.from("club_admins").select("club_id").eq("user_id", profileId),
    sb.from("series_admins").select("series_id").eq("user_id", profileId),
    sb.from("club_players").select("club_id").eq("profile_id", profileId),
  ]);
  const adminClubIds = new Set((adminRes.data ?? []).map((r) => r.club_id as string));
  const adminSeriesIds = new Set((seriesAdminRes.data ?? []).map((r) => r.series_id as string));
  const playerClubIds = new Set((playerRes.data ?? []).map((r) => r.club_id as string));

  const idList = [...new Set([...adminClubIds, ...playerClubIds])];
  const orParts = [`owner_id.eq.${profileId}`];
  if (idList.length > 0) orParts.push(`id.in.(${idList.join(",")})`);
  if (adminSeriesIds.size > 0) orParts.push(`series_id.in.(${[...adminSeriesIds].join(",")})`);

  const { data } = await sb
    .from("clubs")
    .select(
      "id, owner_id, name, venue, play_date, start_time, end_time, max_players, series_id, series:club_series!series_id(id, name, is_adhoc, active_session_id)",
    )
    .or(orParts.join(","))
    .order("play_date", { ascending: false });
  const clubs = (data ?? []) as unknown as ClubRow[];

  const countMap = new Map<string, number>();
  if (clubs.length > 0) {
    const { data: counts } = await sb
      .from("club_players")
      .select("club_id")
      .in("club_id", clubs.map((c) => c.id));
    for (const r of counts ?? []) {
      countMap.set(r.club_id as string, (countMap.get(r.club_id as string) ?? 0) + 1);
    }
  }

  // Managed wins over participant — a manager who also plays gets no badge.
  return clubs.map(({ owner_id, ...c }) => ({
    ...c,
    managed:
      owner_id === profileId ||
      adminClubIds.has(c.id) ||
      (!!c.series_id && adminSeriesIds.has(c.series_id)),
    joined: countMap.get(c.id) ?? 0,
  }));
}
