"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { assertIsOwner, assertCanEdit } from "@/lib/tournament/permissions";
import { writeAuditLog } from "@/lib/tournament/audit";

async function loginRedirect(): Promise<never> {
  const h = await headers();
  const referer = h.get("referer");
  let redirectTo = "/tournaments";
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.pathname !== "/") redirectTo = url.pathname + url.search;
    } catch {}
  }
  redirect(`/?auth_error=login_required&redirectTo=${encodeURIComponent(redirectTo)}`);
}

// ============ TYPES ============

export type TournamentAdmin = {
  tournament_id: string;
  user_id: string;        // profile UUID
  line_user_id: string | null;
  display_name: string | null;
  added_by: string;
  added_at: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// No line_user_id: it's the LINE platform identifier and exposing it to the owner
// turns profile search into a PII-enumeration oracle. The add-co-admin flow keys on
// the opaque profile `id` instead (see addCoAdminAction).
export type ProfileSearchResult = {
  id: string;
  display_name: string | null;
};

export type AuditLogEntry = {
  id: string;
  tournament_id: string;
  actor_id: string;
  actor_name: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  description: string;
  created_at: string;
};

// ============ ACTIONS ============

export async function addCoAdminAction(
  tournamentId: string,
  profileId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");

  if (!(await assertIsOwner(tournamentId, session.profileId))) return { error: t("tournament.noPermission") };

  const trimmed = profileId.trim();
  if (!UUID_RE.test(trimmed)) return { error: t("tournament.selectFromSearch") };

  const sb = await createAdminClient();

  // Resolve by opaque profile id (from searchProfilesAction) — never by line_user_id.
  const { data: profile } = await sb
    .from("profiles")
    .select("id, display_name, is_guest")
    .eq("id", trimmed)
    .maybeSingle();

  if (!profile) return { error: t("tournament.userNotFound") };
  if (profile.id === session.profileId) return { error: t("tournament.cannotAddSelf") };
  if (profile.is_guest) return { error: t("tournament.cannotAddGuest") };

  const { error } = await sb.from("tournament_admins").insert({
    tournament_id: tournamentId,
    user_id: profile.id,
    added_by: session.profileId,
  });

  if (error) {
    if (error.code === "23505") return { error: t("tournament.alreadyCoAdmin") };
    return { error: t("tournament.addCoAdminFailed") };
  }

  const targetName = profile.display_name ?? "(ไม่มีชื่อ)";
  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "admin_added",
    entity_type: "admin",
    entity_id: profile.id,
    description: `เพิ่ม co-admin: ${targetName}`,
  });

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true };
}

export async function removeCoAdminAction(
  tournamentId: string,
  userId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");

  if (!(await assertIsOwner(tournamentId, session.profileId))) return { error: t("tournament.noPermission") };

  const sb = await createAdminClient();
  const { error: deleteError } = await sb
    .from("tournament_admins")
    .delete()
    .eq("tournament_id", tournamentId)
    .eq("user_id", userId);
  if (deleteError) return { error: t("tournament.removeCoAdminFailed") };

  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "admin_removed",
    entity_type: "admin",
    entity_id: userId,
    description: `ลบ co-admin: ${userId}`,
  });

  revalidatePath(`/tournaments/${tournamentId}`);
  return { ok: true };
}

export async function getCoAdminsAction(
  tournamentId: string
): Promise<{ ok: true; admins: TournamentAdmin[] } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");

  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: t("tournament.noPermission") };

  const sb = await createAdminClient();
  type Row = {
    tournament_id: string;
    user_id: string;
    added_by: string;
    added_at: string;
    profile: { line_user_id: string | null; display_name: string | null } | null;
  };
  const { data, error } = await sb
    .from("tournament_admins")
    .select("tournament_id, user_id, added_by, added_at, profile:profiles!user_id(line_user_id, display_name)")
    .eq("tournament_id", tournamentId)
    .order("added_at", { ascending: true });

  if (error) return { error: t("tournament.loadCoAdminsFailed") };

  const admins: TournamentAdmin[] = (data as unknown as Row[] ?? []).map((r) => ({
    tournament_id: r.tournament_id,
    user_id: r.user_id,
    line_user_id: r.profile?.line_user_id ?? null,
    display_name: r.profile?.display_name ?? null,
    added_by: r.added_by,
    added_at: r.added_at,
  }));

  return { ok: true, admins };
}

export async function searchProfilesAction(
  tournamentId: string,
  query: string
): Promise<{ ok: true; results: ProfileSearchResult[] } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");

  if (!(await assertIsOwner(tournamentId, session.profileId))) return { error: t("tournament.noPermission") };

  const q = query.trim();
  if (q.length < 1) return { ok: true, results: [] };

  const sb = await createAdminClient();

  const { data: existing } = await sb
    .from("tournament_admins")
    .select("user_id")
    .eq("tournament_id", tournamentId);

  const excludeIds = [session.profileId, ...(existing ?? []).map((r) => r.user_id)];

  // Escape ILIKE wildcards in user input so '%' / '_' / '\' are treated literally
  const escapedQ = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

  const baseQuery = sb
    .from("profiles")
    // line_user_id is NOT selected (PII) — it's only used as a server-side filter
    // to exclude guests (null line_user_id), never returned to the client.
    .select("id, display_name")
    .ilike("display_name", `%${escapedQ}%`)
    .not("line_user_id", "is", null);

  const filtered = excludeIds.length > 0
    ? baseQuery.not("id", "in", `(${excludeIds.join(",")})`)
    : baseQuery;

  const { data, error } = await filtered.limit(20);

  if (error) return { error: t("tournament.searchFailed") };
  return { ok: true, results: (data ?? []) as ProfileSearchResult[] };
}

export async function getAuditLogsAction(
  tournamentId: string
): Promise<{ ok: true; logs: AuditLogEntry[] } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");

  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: t("tournament.noPermission") };

  const sb = await createAdminClient();
  const { data, error } = await sb
    .from("audit_logs")
    .select("id, tournament_id, actor_id, actor_name, event_type, entity_type, entity_id, description, created_at")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return { error: t("tournament.loadAuditLogsFailed") };
  return { ok: true, logs: (data ?? []) as AuditLogEntry[] };
}
