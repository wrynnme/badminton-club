"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
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
  user_id: string;
  added_by: string;
  added_at: string;
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
  userId: string
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  if (!(await assertIsOwner(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };
  if (userId === session.profileId) return { error: "ไม่สามารถเพิ่มตัวเองเป็น co-admin" };

  const sb = await createAdminClient();
  const { error } = await sb.from("tournament_admins").insert({
    tournament_id: tournamentId,
    user_id: userId,
    added_by: session.profileId,
  });

  if (error) {
    if (error.code === "23505") return { error: "ผู้ใช้นี้เป็น co-admin อยู่แล้ว" };
    return { error: "เพิ่มผู้ช่วยดูแลไม่สำเร็จ" };
  }

  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "admin_added",
    description: `เพิ่ม co-admin: ${userId}`,
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

  if (!(await assertIsOwner(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  await sb
    .from("tournament_admins")
    .delete()
    .eq("tournament_id", tournamentId)
    .eq("user_id", userId);

  await writeAuditLog({
    tournament_id: tournamentId,
    actor_id: session.profileId,
    actor_name: session.displayName,
    event_type: "admin_removed",
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

  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { data, error } = await sb
    .from("tournament_admins")
    .select("tournament_id, user_id, added_by, added_at")
    .eq("tournament_id", tournamentId)
    .order("added_at", { ascending: true });

  if (error) return { error: "โหลดรายชื่อผู้ช่วยดูแลไม่สำเร็จ" };
  return { ok: true, admins: (data ?? []) as TournamentAdmin[] };
}

export async function getAuditLogsAction(
  tournamentId: string
): Promise<{ ok: true; logs: AuditLogEntry[] } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  if (!(await assertCanEdit(tournamentId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const sb = await createAdminClient();
  const { data, error } = await sb
    .from("audit_logs")
    .select("id, tournament_id, actor_id, actor_name, event_type, entity_type, entity_id, description, created_at")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return { error: "โหลดประวัติการแก้ไขไม่สำเร็จ" };
  return { ok: true, logs: (data ?? []) as AuditLogEntry[] };
}
