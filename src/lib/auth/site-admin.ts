import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * True when the current session belongs to the single site owner
 * (`profiles.is_site_admin`). Site admins edit global settings at /admin.
 */
export async function isSiteAdmin(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  const sb = await createAdminClient();
  const { data } = await sb
    .from("profiles")
    .select("is_site_admin")
    .eq("id", session.profileId)
    .maybeSingle();
  return data?.is_site_admin === true;
}
