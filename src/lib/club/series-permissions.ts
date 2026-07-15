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
 * Owner OR a series-level co-admin (`series_admins`, P3) OR — legacy fallback —
 * a co-admin of ANY session (`clubs` row) under this series. Co-admin
 * management moved to the series settings tab in P3 (`addSeriesCoAdminAction` /
 * `removeSeriesCoAdminAction` in `club-series.ts`), but a club created before
 * P3 (or whose co-admins were never re-added at the series level) still has its
 * co-admins sitting on the per-session `club_admins` table only — EXPAND
 * discipline keeps that path readable until CONTRACT (see docs/adr/0002).
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

  const { data: seriesAdmin } = await sb
    .from("series_admins")
    .select("user_id")
    .eq("series_id", seriesId)
    .eq("user_id", profileId)
    .maybeSingle();
  if (seriesAdmin) return true;

  // Legacy fallback — see doc comment above.
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
