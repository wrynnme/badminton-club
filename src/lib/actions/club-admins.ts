"use server";

import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { loginRedirect, assertClubOwner } from "@/lib/club/permissions";
import { revalidateClubTree } from "@/lib/club/revalidate";

// line_user_id omitted (PII) — exposing it to the owner turns profile search into a
// PII-enumeration oracle. The add-co-admin flow keys on the opaque profile id instead.
export type ClubProfileSearchResult = {
  id: string;
  display_name: string | null;
};

export type ClubAdmin = {
  club_id: string;
  user_id: string;
  display_name: string | null;
  line_user_id: string | null;
  added_by: string | null;
  added_at: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function addClubCoAdminAction(
  clubId: string,
  profileId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertClubOwner(sb, clubId, session.profileId))) return { error: t("club.noPermission") };

  const trimmed = profileId.trim();
  if (!UUID_RE.test(trimmed)) return { error: t("club.selectUserFromSearch") };

  // Resolve by opaque profile id (from searchClubProfilesAction) — never by line_user_id.
  const { data: profile } = await sb
    .from("profiles")
    .select("id")
    .eq("id", trimmed)
    .maybeSingle();

  if (!profile) return { error: t("club.userNotFound") };
  if (profile.id === session.profileId) return { error: t("club.cannotAddSelfAsCoAdmin") };

  const { error } = await sb.from("club_admins").insert({
    club_id: clubId,
    user_id: profile.id,
    added_by: session.profileId,
  });

  if (error) {
    if (error.code === "23505") return { error: t("club.alreadyCoAdmin") };
    return { error: t("club.addCoAdminFailed") };
  }

  revalidateClubTree();
  return { ok: true };
}

export async function removeClubCoAdminAction(
  clubId: string,
  userId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertClubOwner(sb, clubId, session.profileId))) return { error: t("club.noPermission") };

  const { error: deleteError } = await sb
    .from("club_admins")
    .delete()
    .eq("club_id", clubId)
    .eq("user_id", userId);
  if (deleteError) return { error: t("club.removeCoAdminFailed") };

  revalidateClubTree();
  return { ok: true };
}

export async function searchClubProfilesAction(
  clubId: string,
  query: string
): Promise<{ ok: true; results: ClubProfileSearchResult[] } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertClubOwner(sb, clubId, session.profileId))) return { error: t("club.noPermission") };

  const q = query.trim();
  if (q.length < 2) return { ok: true, results: [] };

  const { data: existing } = await sb
    .from("club_admins")
    .select("user_id")
    .eq("club_id", clubId);

  const excludeIds = [session.profileId, ...(existing ?? []).map((r) => r.user_id)];
  const escapedQ = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

  // excludeIds always has session.profileId — never empty
  const { data, error } = await sb
    .from("profiles")
    // line_user_id is NOT selected (PII) — only used as a server-side filter to
    // exclude guests (null line_user_id), never returned to the client.
    .select("id, display_name")
    .ilike("display_name", `%${escapedQ}%`)
    .not("line_user_id", "is", null)
    .not("id", "in", `(${excludeIds.join(",")})`)
    .limit(20);

  if (error) return { error: t("club.searchFailed") };
  return { ok: true, results: (data ?? []) as ClubProfileSearchResult[] };
}
