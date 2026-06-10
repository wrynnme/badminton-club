"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import {
  ClubPresetConfigSchema,
  parsePresetConfig,
  type ClubPresetConfig,
} from "@/lib/club/preset";
import type { ClubPreset } from "@/lib/types";

async function loginRedirect(): Promise<never> {
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

async function assertPresetOwner(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  presetId: string,
  profileId: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from("club_presets")
    .select("owner_id")
    .eq("id", presetId)
    .maybeSingle();
  // Fail closed on a transient DB error: return false (→ clean { error: "ไม่มีสิทธิ์" })
  // rather than throwing an uncaught exception that surfaces as a 500.
  if (error) return false;
  if (!data || data.owner_id !== profileId) return false;
  return true;
}

// ─── List ────────────────────────────────────────────────────────────────────

export async function listClubPresetsAction(): Promise<
  { presets: ClubPreset[] } | { error: string }
> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (session.isGuest) return { error: "ต้องเข้าสู่ระบบด้วย LINE เพื่อใช้งานพรีเซ็ต" };

  const sb = await createAdminClient();
  const { data, error } = await sb
    .from("club_presets")
    .select("id, owner_id, name, config, created_at")
    .eq("owner_id", session.profileId)
    .order("created_at", { ascending: false });

  if (error) return { error: error.message };

  const presets: ClubPreset[] = (data ?? []).map((row) => ({
    id: row.id as string,
    owner_id: row.owner_id as string,
    name: row.name as string,
    config: parsePresetConfig(row.config),
    created_at: row.created_at as string,
  }));

  return { presets };
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createClubPresetAction(input: {
  name: string;
  config: ClubPresetConfig;
}): Promise<{ id: string } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (session.isGuest) return { error: "ต้องเข้าสู่ระบบด้วย LINE เพื่อสร้างพรีเซ็ต" };

  const nameResult = z.string().min(2, "ชื่อพรีเซ็ตสั้นไป").safeParse(input.name);
  if (!nameResult.success) {
    return { error: nameResult.error.issues[0]?.message ?? "ชื่อไม่ถูกต้อง" };
  }

  let parsedConfig: ClubPresetConfig;
  try {
    parsedConfig = ClubPresetConfigSchema.parse(input.config);
  } catch {
    return { error: "ข้อมูลการตั้งค่าไม่ถูกต้อง" };
  }

  const sb = await createAdminClient();
  const { data, error } = await sb
    .from("club_presets")
    .insert({ owner_id: session.profileId, name: nameResult.data, config: parsedConfig })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "สร้างพรีเซ็ตไม่สำเร็จ" };

  revalidatePath("/clubs");
  return { id: data.id as string };
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateClubPresetAction(
  presetId: string,
  input: { name?: string; config?: ClubPresetConfig },
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (session.isGuest) return { error: "ต้องเข้าสู่ระบบด้วย LINE เพื่อแก้ไขพรีเซ็ต" };

  const sb = await createAdminClient();
  if (!(await assertPresetOwner(sb, presetId, session.profileId))) {
    return { error: "ไม่มีสิทธิ์" };
  }

  const patch: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const nameResult = z.string().min(2, "ชื่อพรีเซ็ตสั้นไป").safeParse(input.name);
    if (!nameResult.success) {
      return { error: nameResult.error.issues[0]?.message ?? "ชื่อไม่ถูกต้อง" };
    }
    patch.name = nameResult.data;
  }

  if (input.config !== undefined) {
    try {
      patch.config = ClubPresetConfigSchema.parse(input.config);
    } catch {
      return { error: "ข้อมูลการตั้งค่าไม่ถูกต้อง" };
    }
  }

  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await sb.from("club_presets").update(patch).eq("id", presetId);
  if (error) return { error: error.message };

  revalidatePath("/clubs");
  return { ok: true };
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export async function deleteClubPresetAction(
  presetId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (session.isGuest) return { error: "ต้องเข้าสู่ระบบด้วย LINE เพื่อลบพรีเซ็ต" };

  const sb = await createAdminClient();
  if (!(await assertPresetOwner(sb, presetId, session.profileId))) {
    return { error: "ไม่มีสิทธิ์" };
  }

  const { error } = await sb.from("club_presets").delete().eq("id", presetId);
  if (error) return { error: error.message };

  revalidatePath("/clubs");
  return { ok: true };
}

// ─── Apply ───────────────────────────────────────────────────────────────────

/**
 * One-shot seed: creates a brand-new independent club pre-filled from the
 * preset config, then inserts co-admins and regulars.
 *
 * Strategy:
 *  1. Verify ownership.
 *  2. Insert the `clubs` row — bail on error before touching children.
 *  3. Insert `club_admins` rows for co_admin_ids (skip caller + ignore 23505).
 *  4. Bulk-insert `club_players` from regulars (position 1..N, active/reserve
 *     split at max_players). Uses plain insert — no RPC — because the club is
 *     brand-new and there is no concurrency risk on an empty club.
 */
export async function applyClubPresetAction(
  presetId: string,
): Promise<{ clubId: string } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  if (session.isGuest) return { error: "ต้องเข้าสู่ระบบด้วย LINE เพื่อใช้งานพรีเซ็ต" };

  const sb = await createAdminClient();
  if (!(await assertPresetOwner(sb, presetId, session.profileId))) {
    return { error: "ไม่มีสิทธิ์" };
  }

  // Load + parse preset
  const { data: presetRow, error: presetErr } = await sb
    .from("club_presets")
    .select("name, config")
    .eq("id", presetId)
    .single();
  if (presetErr || !presetRow) return { error: "ไม่พบพรีเซ็ต" };

  const config = parsePresetConfig(presetRow.config);

  // Derive today's date server-side (server action — Date is allowed here)
  const today = new Date().toISOString().slice(0, 10);

  // Derive courts array from court_count
  const courts = Array.from({ length: config.court_count }, (_, i) => String(i + 1));

  // Build queue_settings from config fields
  const queueSettings = {
    court_count: config.court_count,
    players_per_team: config.players_per_team,
    rotation_mode: config.rotation_mode,
    queue_mode: config.queue_mode,
  };

  // ── Step 1: Insert clubs row ──────────────────────────────────────────────
  const { data: clubData, error: clubErr } = await sb
    .from("clubs")
    .insert({
      name: presetRow.name as string,
      venue: config.venue || "ก๊วน",
      play_date: today,
      start_time: config.start_time || "18:00",
      end_time: config.end_time || "21:00",
      max_players: config.max_players,
      court_fee: config.court_fee,
      shuttle_price: config.shuttle_price,
      courts,
      queue_settings: queueSettings,
      owner_id: session.profileId,
    })
    .select("id")
    .single();

  if (clubErr || !clubData) return { error: clubErr?.message ?? "สร้างก๊วนไม่สำเร็จ" };

  const clubId = clubData.id as string;

  // Compensating cleanup: deleting the club CASCADEs to club_admins/club_players,
  // so on any child-insert failure we remove the just-created club instead of
  // leaving an orphaned, half-seeded club behind.
  const rollback = async (): Promise<void> => {
    await sb.from("clubs").delete().eq("id", clubId);
  };

  // ── Step 2: Insert co-admins (dedup; never include the owner) ──────────────
  const coAdminIds = [
    ...new Set((config.co_admin_ids ?? []).filter((uid) => uid !== session.profileId)),
  ];
  if (coAdminIds.length > 0) {
    const adminRows = coAdminIds.map((userId) => ({
      club_id: clubId,
      user_id: userId,
      added_by: session.profileId,
    }));
    const { error: adminErr } = await sb.from("club_admins").insert(adminRows);
    // A non-existent co_admin_id is a FK violation (23503), NOT 23505 — only true
    // duplicates (23505) are safe to ignore; any other error rolls back the club.
    if (adminErr && adminErr.code !== "23505") {
      await rollback();
      return { error: adminErr.message };
    }
  }

  // ── Step 3: Bulk-insert regulars ──────────────────────────────────────────
  const regulars = config.regulars ?? [];
  if (regulars.length > 0) {
    const playerRows = regulars.map((reg, idx) => ({
      club_id: clubId,
      profile_id: reg.profile_id ?? null,
      display_name: reg.name,
      position: idx + 1,
      status: idx < config.max_players ? "active" : "reserve",
      start_time: reg.start_time ?? null,
      end_time: reg.end_time ?? null,
    }));
    const { error: playersErr } = await sb.from("club_players").insert(playerRows);
    if (playersErr) {
      await rollback();
      return { error: playersErr.message };
    }
  }

  revalidatePath("/clubs");
  return { clubId };
}
