import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function loginRedirect(): Promise<never> {
  const h = await headers();
  const referer = h.get("referer");
  let redirectTo = "/clubs";
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.pathname !== "/") redirectTo = url.pathname + url.search;
    } catch {}
  }
  redirect(`/?auth_error=login_required&redirectTo=${encodeURIComponent(redirectTo)}`);
}

export async function assertClubOwner(sb: Awaited<ReturnType<typeof createAdminClient>>, clubId: string, profileId: string) {
  const { data, error } = await sb.from("clubs").select("owner_id").eq("id", clubId).maybeSingle();
  if (error) throw new Error("permission_check_failed");
  if (!data || data.owner_id !== profileId) return false;
  return true;
}

export async function assertCanManageClub(sb: Awaited<ReturnType<typeof createAdminClient>>, clubId: string, profileId: string) {
  const { data, error } = await sb
    .from("clubs")
    .select("owner_id, series_id, club_admins!left(user_id)")
    .eq("id", clubId)
    .eq("club_admins.user_id", profileId)
    .maybeSingle();
  if (error) throw new Error("permission_check_failed");
  if (!data) return false;
  const admins = (data.club_admins ?? []) as { user_id: string }[];
  if (data.owner_id === profileId || admins.length > 0) return true;

  // ADR 0002 P3 — a series-level co-admin (`series_admins`) manages every
  // session of the series, same as a legacy per-session `club_admins` row.
  // Skipped for a not-yet-migrated club (series_id null) — nothing to check.
  if (!data.series_id) return false;
  const { data: seriesAdmin } = await sb
    .from("series_admins")
    .select("user_id")
    .eq("series_id", data.series_id)
    .eq("user_id", profileId)
    .maybeSingle();
  return !!seriesAdmin;
}
