"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { loginRedirect, assertCanManageClub } from "@/lib/club/permissions";

const GuestSchema = z.object({
  club_id: z.string().uuid(),
  display_name: z.string().min(1, "ระบุชื่อ").max(60, "ชื่อยาวเกินไป"),
  level_id: z.string().uuid().optional().nullable(),
  note: z.string().optional().nullable(),
});

export type AddGuestInput = z.infer<typeof GuestSchema>;

const PlayerSessionSchema = z.object({
  start_time: z.string().optional().nullable(), // "HH:MM" | "" | null → null = use club window
  end_time: z.string().optional().nullable(),
  games_played: z.coerce.number().int().min(0).max(500),
});

export type PlayerSessionInput = z.infer<typeof PlayerSessionSchema>;

/**
 * Owner / co-admin adds a guest player to the club — a name-only row with
 * profile_id = NULL (no LINE account needed). The UNIQUE(club_id, profile_id)
 * constraint ignores NULLs, so any number of guests can be added.
 */
export async function addGuestPlayerAction(input: AddGuestInput) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const parsed = GuestSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, parsed.data.club_id, session.profileId))) {
    return { error: "ไม่มีสิทธิ์" };
  }

  // Atomic capacity check + insert under a club-row lock (add_club_player RPC):
  // it counts active players and inserts as 'active', or 'reserve' when at cap,
  // in one transaction — so concurrent adds at the cap can't overshoot
  // max_players (the previous read-then-insert could). Auto-promoted when an
  // active player later leaves.
  const { error } = await sb.rpc("add_club_player", {
    p_club_id: parsed.data.club_id,
    p_display_name: parsed.data.display_name.trim(),
    p_level_id: parsed.data.level_id || null,
    p_note: parsed.data.note || null,
  });
  if (error) {
    return { error: error.message.includes("club not found") ? "ไม่พบก๊วนนี้" : error.message };
  }

  revalidatePath(`/clubs/${parsed.data.club_id}`);
  return { ok: true };
}

/** Owner / co-admin sets a player's session window + games played (cost-split inputs). */
export async function updateClubPlayerSessionAction(
  clubId: string,
  playerId: string,
  input: PlayerSessionInput,
) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const parsed = PlayerSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: "ไม่มีสิทธิ์" };
  }

  const { error } = await sb
    .from("club_players")
    .update({
      start_time: parsed.data.start_time?.trim() || null,
      end_time: parsed.data.end_time?.trim() || null,
      games_played: parsed.data.games_played,
    })
    .eq("id", playerId)
    .eq("club_id", clubId);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

export async function reorderPlayersAction(clubId: string, orderedIds: string[]) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const results = await Promise.all(
    orderedIds.map((id, i) =>
      sb.from("club_players").update({ position: i + 1 }).eq("id", id).eq("club_id", clubId)
    )
  );
  // Don't silently swallow a partial failure — mirror reorderClubQueueAction.
  for (const { error } of results) {
    if (error) return { error: "จัดลำดับไม่สำเร็จ" };
  }

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

export async function kickPlayerAction(formData: FormData) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const clubId = formData.get("club_id") as string;
  const playerId = formData.get("player_id") as string;

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId)))
    return { error: "ไม่มีสิทธิ์" };

  // Delete + auto-promote the earliest reserve into the freed slot (atomic RPC).
  await sb.rpc("remove_club_player_and_promote", {
    p_player_id: playerId,
    p_club_id: clubId,
  });
  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

/**
 * Manager drags a reserve up into the active list → promote it. Admin override:
 * promotes regardless of the max_players cap (the manager is deliberately
 * over-filling). Status flip only — keeps the player's position. No-op (error)
 * if the player isn't a reserve of this club.
 */
export async function promoteClubReserveAction(input: { clubId: string; playerId: string }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, input.clubId, session.profileId)))
    return { error: "ไม่มีสิทธิ์" };

  const { data: updated, error } = await sb
    .from("club_players")
    .update({ status: "active" })
    .eq("id", input.playerId)
    .eq("club_id", input.clubId)
    .eq("status", "reserve")
    .select("id")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!updated) {
    // No reserve row flipped — either the player isn't here, or a concurrent
    // leave/kick auto-promote already made them active. Re-read to tell the two
    // apart so a benign double-promote returns success instead of a false error.
    const { data: current } = await sb
      .from("club_players")
      .select("status")
      .eq("id", input.playerId)
      .eq("club_id", input.clubId)
      .maybeSingle();
    if (current?.status !== "active") return { error: "ผู้เล่นนี้เลื่อนเป็นตัวจริงไม่ได้" };
  }

  revalidatePath(`/clubs/${input.clubId}`);
  return { ok: true };
}

export async function toggleCheckInAction(input: { club_id: string; player_id: string }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const sb = await createAdminClient();

  if (!(await assertCanManageClub(sb, input.club_id, session.profileId)))
    return { error: "ไม่มีสิทธิ์" };

  const { data: player } = await sb
    .from("club_players")
    .select("checked_in_at")
    .eq("id", input.player_id)
    .eq("club_id", input.club_id)
    .single();

  if (!player) return { error: "ไม่พบผู้เล่น" };

  const next = player.checked_in_at ? null : new Date().toISOString();
  const { error } = await sb
    .from("club_players")
    .update({ checked_in_at: next })
    .eq("id", input.player_id);

  if (error) return { error: error.message };
  revalidatePath(`/clubs/${input.club_id}`);
  return { ok: true };
}

// ─── Leave ────────────────────────────────────────────────────────────────────

export async function leaveClubAction(formData: FormData) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const clubId = formData.get("club_id") as string;
  const sb = await createAdminClient();

  // Resolve the caller's player row, then delete + auto-promote a reserve (atomic).
  const { data: row } = await sb
    .from("club_players")
    .select("id")
    .eq("club_id", clubId)
    .eq("profile_id", session.profileId)
    .maybeSingle();
  if (row) {
    await sb.rpc("remove_club_player_and_promote", {
      p_player_id: row.id,
      p_club_id: clubId,
    });
  }

  revalidatePath(`/clubs/${clubId}`);
}

// ─── Per-player discount + guest rename ───────────────────────────────────────

/** Owner / co-admin sets a player's discount (subtracted from the cost breakdown total). */
export async function updateClubPlayerDiscountAction(
  clubId: string,
  playerId: string,
  discount: number,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const d = Number(discount);
  if (!Number.isFinite(d) || d < 0 || d > 1_000_000) return { error: "ส่วนลดไม่ถูกต้อง" };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const { error } = await sb
    .from("club_players")
    .update({ discount: d })
    .eq("id", playerId)
    .eq("club_id", clubId);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

/** Owner / co-admin renames a guest player (profile_id IS NULL — LINE players keep their account name). */
export async function renameClubGuestAction(
  clubId: string,
  playerId: string,
  displayName: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const name = displayName.trim();
  if (name.length < 1 || name.length > 60) return { error: "ชื่อยาว 1–60 ตัวอักษร" };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: "ไม่มีสิทธิ์" };

  const { data: player, error: fetchError } = await sb
    .from("club_players")
    .select("id, profile_id")
    .eq("id", playerId)
    .eq("club_id", clubId)
    .single();
  if (fetchError || !player) return { error: "ไม่พบผู้เล่น" };
  if (player.profile_id) return { error: "แก้ชื่อได้เฉพาะผู้เล่น guest" };

  const { error } = await sb
    .from("club_players")
    .update({ display_name: name })
    .eq("id", playerId);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}
