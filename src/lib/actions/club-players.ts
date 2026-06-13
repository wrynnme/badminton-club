"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { loginRedirect, assertCanManageClub } from "@/lib/club/permissions";

function guestSchema(nameRequiredMsg: string, nameTooLongMsg: string) {
  return z.object({
    club_id: z.string().uuid(),
    display_name: z.string().min(1, nameRequiredMsg).max(60, nameTooLongMsg),
    level_id: z.string().uuid().optional().nullable(),
    note: z.string().optional().nullable(),
  });
}
// Static fallback for type inference only; call sites pass translated messages.
const GuestSchema = guestSchema("name_required", "name_too_long");

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

  const t = await getTranslations("actions");
  const parsed = guestSchema(t("club.guestNameRequired"), t("club.guestNameTooLong")).safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? t("club.invalidData") };
  }

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, parsed.data.club_id, session.profileId))) {
    return { error: t("club.noPermission") };
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
    return { error: error.message.includes("club not found") ? t("club.clubNotFound") : error.message };
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

  const t = await getTranslations("actions");
  const parsed = PlayerSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? t("club.invalidData") };
  }

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
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

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: t("club.noPermission") };

  const results = await Promise.all(
    orderedIds.map((id, i) =>
      sb.from("club_players").update({ position: i + 1 }).eq("id", id).eq("club_id", clubId)
    )
  );
  // Don't silently swallow a partial failure — mirror reorderClubQueueAction.
  for (const { error } of results) {
    if (error) return { error: t("club.reorderFailed") };
  }

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

export async function kickPlayerAction(formData: FormData) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const clubId = formData.get("club_id") as string;
  const playerId = formData.get("player_id") as string;

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId)))
    return { error: t("club.noPermission") };

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

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, input.clubId, session.profileId)))
    return { error: t("club.noPermission") };

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
    if (current?.status !== "active") return { error: t("club.cannotPromotePlayer") };
  }

  revalidatePath(`/clubs/${input.clubId}`);
  return { ok: true };
}

export async function toggleCheckInAction(input: { club_id: string; player_id: string }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();

  if (!(await assertCanManageClub(sb, input.club_id, session.profileId)))
    return { error: t("club.noPermission") };

  const { data: player } = await sb
    .from("club_players")
    .select("checked_in_at")
    .eq("id", input.player_id)
    .eq("club_id", input.club_id)
    .single();

  if (!player) return { error: t("club.playerNotFound") };

  const next = player.checked_in_at ? null : new Date().toISOString();
  const { error } = await sb
    .from("club_players")
    .update({ checked_in_at: next })
    .eq("id", input.player_id)
    .eq("club_id", input.club_id);

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

  const t = await getTranslations("actions");
  const d = Number(discount);
  if (!Number.isFinite(d) || d < 0 || d > 1_000_000) return { error: t("club.invalidDiscount") };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: t("club.noPermission") };

  const { error } = await sb
    .from("club_players")
    .update({ discount: d })
    .eq("id", playerId)
    .eq("club_id", clubId);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

// ─── Batch LINE import ────────────────────────────────────────────────────────

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const playerWithTimeSchema = z.object({
  name: z.string().min(1).max(60),
  start_time: z.string().regex(TIME_RE).nullable().optional(),
  end_time: z.string().regex(TIME_RE).nullable().optional(),
});

const importSchema = z.object({
  club_id: z.string().uuid(),
  players: z.array(playerWithTimeSchema).min(0).max(100),
  reserve_players: z.array(playerWithTimeSchema).min(0).max(50),
});

export type ImportPlayerItem = z.infer<typeof playerWithTimeSchema>;
export type ImportClubPlayersInput = z.infer<typeof importSchema>;

export type ImportClubPlayersOk = {
  ok: true;
  added: number;
  reserved: number;
  skipped: number;
  failed: number;
};

/**
 * Batch-import guest players parsed from a LINE sign-up message.
 *
 * Main players go through the `add_club_player` RPC (atomic capacity check).
 * Reserve players are inserted directly with status='reserve'.
 * Duplicates (against existing club_players.display_name) are skipped.
 *
 * After the main-player RPC loop, time windows are applied in a separate
 * Promise.all pass. A failed time-update does NOT decrement `added` — the
 * player row exists; the time window is a best-effort enrichment. This is safe
 * because in-batch dedup (below) guarantees each name appears at most once in
 * `mainPlayers`, and pre-existing duplicates were already skipped, so the
 * follow-up UPDATE by (club_id, display_name) is unambiguous.
 */
export async function importClubPlayersAction(
  input: ImportClubPlayersInput,
): Promise<ImportClubPlayersOk | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) {
    return { error: t("club.importPlayersInvalidInput") };
  }

  const { club_id, players, reserve_players } = parsed.data;
  const sb = await createAdminClient();

  if (!(await assertCanManageClub(sb, club_id, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  // Fetch existing display_names to detect duplicates.
  const { data: existing } = await sb
    .from("club_players")
    .select("display_name")
    .eq("club_id", club_id);
  const existingSet = new Set(
    (existing ?? []).map((r) => r.display_name.trim().toLowerCase()),
  );

  // Dedupe within the batch (case-insensitive, order-preserving first-seen),
  // keyed on name.
  function dedupePlayers(list: ImportPlayerItem[]): ImportPlayerItem[] {
    const seen = new Set<string>();
    return list.filter((item) => {
      const key = item.name.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const mainPlayers = dedupePlayers(players);
  const resPlayers = dedupePlayers(reserve_players);

  let added = 0;
  let skipped = 0;
  let failed = 0;

  // ── Main players via RPC (atomic capacity + status assignment) ─────────────
  // Track which successfully-added players carry a time window for the follow-up pass.
  const timeUpdates: { id: string; start_time: string; end_time: string }[] = [];

  for (const item of mainPlayers) {
    if (existingSet.has(item.name.trim().toLowerCase())) {
      skipped++;
      continue;
    }
    const { data: inserted, error } = await sb.rpc("add_club_player", {
      p_club_id: club_id,
      p_display_name: item.name,
      p_level_id: null,
      p_note: null,
    });
    if (error) {
      failed++;
    } else {
      added++;
      existingSet.add(item.name.trim().toLowerCase());
      // Apply the time window by the freshly-inserted row id — NOT by display_name:
      // a name shared with a pre-existing player would otherwise overwrite that
      // player's session window too.
      if (item.start_time && item.end_time && inserted?.id) {
        timeUpdates.push({
          id: inserted.id,
          start_time: item.start_time,
          end_time: item.end_time,
        });
      }
    }
  }

  // ── Follow-up: apply time windows for successfully-added main players ──────
  // Failures are silently ignored — `added` count is NOT decremented.
  if (timeUpdates.length > 0) {
    await Promise.all(
      timeUpdates.map(({ id, start_time, end_time }) =>
        sb
          .from("club_players")
          .update({ start_time, end_time })
          .eq("id", id),
      ),
    );
  }

  // ── Reserve players: direct insert at tail of position sequence ───────────
  let reserved = 0;

  if (resPlayers.length > 0) {
    const { data: maxRow } = await sb
      .from("club_players")
      .select("position")
      .eq("club_id", club_id)
      .order("position", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const basePosition = (maxRow?.position ?? 0) + 1;

    const insertRows = resPlayers
      .filter((item) => !existingSet.has(item.name.trim().toLowerCase()))
      .map((item, i) => ({
        club_id,
        profile_id: null as null,
        display_name: item.name,
        status: "reserve" as const,
        position: basePosition + i,
        level_id: null as null,
        note: null as null,
        start_time: item.start_time ?? null,
        end_time: item.end_time ?? null,
      }));

    skipped += resPlayers.length - insertRows.length;

    if (insertRows.length > 0) {
      const { error } = await sb.from("club_players").insert(insertRows);
      if (error) {
        failed += insertRows.length;
      } else {
        reserved = insertRows.length;
      }
    }
  }

  revalidatePath(`/clubs/${club_id}`);
  return { ok: true, added, reserved, skipped, failed };
}

// ─── Bulk actions ─────────────────────────────────────────────────────────────

const BulkIdsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(100)
  .transform((ids) => [...new Set(ids)]); // dedupe

/**
 * Bulk check-in / undo check-in for a set of players.
 * Idempotent: only touches rows whose current state differs from the desired state.
 */
export async function bulkCheckInClubPlayersAction(input: {
  clubId: string;
  playerIds: string[];
  checkIn: boolean;
}): Promise<{ ok: true; count: number } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const ids = BulkIdsSchema.safeParse(input.playerIds);
  if (!ids.success) return { error: t("club.invalidData") };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, input.clubId, session.profileId)))
    return { error: t("club.noPermission") };

  let query = sb
    .from("club_players")
    .update({ checked_in_at: input.checkIn ? new Date().toISOString() : null })
    .eq("club_id", input.clubId)
    .in("id", ids.data);

  // Only touch rows whose state differs to keep the operation idempotent.
  if (input.checkIn) {
    query = query.is("checked_in_at", null);
  } else {
    query = query.not("checked_in_at", "is", null);
  }

  const { data, error } = await query.select("id");
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${input.clubId}`);
  return { ok: true, count: data?.length ?? 0 };
}

/**
 * Bulk set status ("active" | "reserve") for a set of players.
 * Admin override — no cap check (same as promoteClubReserveAction).
 * Only touches rows whose status currently differs.
 */
export async function bulkSetClubPlayerStatusAction(input: {
  clubId: string;
  playerIds: string[];
  status: "active" | "reserve";
}): Promise<{ ok: true; count: number } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const ids = BulkIdsSchema.safeParse(input.playerIds);
  if (!ids.success) return { error: t("club.invalidData") };
  if (input.status !== "active" && input.status !== "reserve")
    return { error: t("club.invalidData") };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, input.clubId, session.profileId)))
    return { error: t("club.noPermission") };

  const { data, error } = await sb
    .from("club_players")
    .update({ status: input.status })
    .eq("club_id", input.clubId)
    .in("id", ids.data)
    .neq("status", input.status) // only rows that need changing
    .select("id");

  if (error) return { error: error.message };

  revalidatePath(`/clubs/${input.clubId}`);
  return { ok: true, count: data?.length ?? 0 };
}

const BulkSessionSchema = z.object({
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  games_played: z.coerce.number().int().min(0).max(500).optional(),
});

/**
 * Bulk update session fields for a set of players.
 * Only applies fields explicitly provided (undefined = leave untouched).
 * Empty string times ("") are stored as null (= use club window).
 */
export async function bulkUpdateClubPlayerSessionAction(input: {
  clubId: string;
  playerIds: string[];
  start_time?: string;
  end_time?: string;
  games_played?: number;
}): Promise<{ ok: true; count: number } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const ids = BulkIdsSchema.safeParse(input.playerIds);
  if (!ids.success) return { error: t("club.invalidData") };

  const parsed = BulkSessionSchema.safeParse({
    start_time: input.start_time,
    end_time: input.end_time,
    games_played: input.games_played,
  });
  if (!parsed.success) return { error: t("club.invalidData") };

  // Build only the fields that were explicitly provided.
  const patch: Record<string, unknown> = {};
  if (input.start_time !== undefined)
    patch.start_time = parsed.data.start_time?.trim() || null;
  if (input.end_time !== undefined)
    patch.end_time = parsed.data.end_time?.trim() || null;
  if (input.games_played !== undefined)
    patch.games_played = parsed.data.games_played;

  if (Object.keys(patch).length === 0)
    return { error: t("club.bulkSessionNoFields") };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, input.clubId, session.profileId)))
    return { error: t("club.noPermission") };

  const { data, error } = await sb
    .from("club_players")
    .update(patch)
    .eq("club_id", input.clubId)
    .in("id", ids.data)
    .select("id");

  if (error) return { error: error.message };

  revalidatePath(`/clubs/${input.clubId}`);
  return { ok: true, count: data?.length ?? 0 };
}

/**
 * Bulk delete players using the atomic remove_club_player_and_promote RPC
 * (delete + auto-promote earliest reserve into the freed slot) called sequentially
 * per player so the promote semantics hold after each removal.
 */
export async function bulkDeleteClubPlayersAction(input: {
  clubId: string;
  playerIds: string[];
}): Promise<{ ok: true; deleted: number; failed: number } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const ids = BulkIdsSchema.safeParse(input.playerIds);
  if (!ids.success) return { error: t("club.invalidData") };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, input.clubId, session.profileId)))
    return { error: t("club.noPermission") };

  let deleted = 0;
  let failed = 0;
  for (const playerId of ids.data) {
    const { error } = await sb.rpc("remove_club_player_and_promote", {
      p_player_id: playerId,
      p_club_id: input.clubId,
    });
    if (error) {
      failed++;
    } else {
      deleted++;
    }
  }

  revalidatePath(`/clubs/${input.clubId}`);
  return { ok: true, deleted, failed };
}

/** Owner / co-admin renames a guest player (profile_id IS NULL — LINE players keep their account name). */
export async function renameClubGuestAction(
  clubId: string,
  playerId: string,
  displayName: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const name = displayName.trim();
  if (name.length < 1 || name.length > 60) return { error: t("club.nameLength") };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) return { error: t("club.noPermission") };

  const { data: player, error: fetchError } = await sb
    .from("club_players")
    .select("id, profile_id")
    .eq("id", playerId)
    .eq("club_id", clubId)
    .single();
  if (fetchError || !player) return { error: t("club.playerNotFound") };
  if (player.profile_id) return { error: t("club.renameGuestOnly") };

  const { error } = await sb
    .from("club_players")
    .update({ display_name: name })
    .eq("id", playerId);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}
