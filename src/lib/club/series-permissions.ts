import { createAdminClient } from "@/lib/supabase/server";

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

/** Owner-only gate — mirrors `assertClubOwner` in `@/lib/club/permissions`. */
export async function assertSeriesOwner(
  sb: AdminClient,
  seriesId: string,
  profileId: string,
): Promise<boolean> {
  const { data, error } = await sb.from("club_series").select("owner_id").eq("id", seriesId).maybeSingle();
  if (error) throw new Error("permission_check_failed");
  if (!data || data.owner_id !== profileId) return false;
  return true;
}

/**
 * Owner OR a co-admin of ANY session (`clubs` row) under this series. Co-admins
 * are still per-session until P3 lifts them to the series level (see ADR 0002
 * roadmap) — so this walks every session's `club_admins` instead of a
 * series-level admin table that doesn't exist yet.
 */
export async function assertCanManageSeries(
  sb: AdminClient,
  seriesId: string,
  profileId: string,
): Promise<boolean> {
  const { data: series, error } = await sb
    .from("club_series")
    .select("owner_id")
    .eq("id", seriesId)
    .maybeSingle();
  if (error) throw new Error("permission_check_failed");
  if (!series) return false;
  if (series.owner_id === profileId) return true;

  const { data: clubs } = await sb.from("clubs").select("id").eq("series_id", seriesId);
  const clubIds = (clubs ?? []).map((c) => c.id as string);
  if (clubIds.length === 0) return false;

  const { data: admin } = await sb
    .from("club_admins")
    .select("club_id")
    .eq("user_id", profileId)
    .in("club_id", clubIds)
    .limit(1)
    .maybeSingle();
  return !!admin;
}
