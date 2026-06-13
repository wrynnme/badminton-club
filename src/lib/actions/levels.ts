"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { assertCanManageClub } from "@/lib/club/permissions";
import type { Level } from "@/lib/types";

function levelSchema(labelRequiredMsg: string) {
  return z.object({
    real: z.coerce.number().min(0).max(100),
    label: z.string().trim().min(1, labelRequiredMsg).max(20),
    sort_order: z.coerce.number().int().min(0).max(10_000).optional(),
  });
}
// Static fallback for type inference only; call sites pass translated messages.
const LevelSchema = levelSchema("label_required");

/** Global levels only (club_id IS NULL). Used by tournament pages. */
export async function getGlobalLevelsAction(): Promise<Level[]> {
  const sb = await createAdminClient();
  const { data } = await sb
    .from("levels")
    .select("*")
    .is("club_id", null)
    .order("sort_order", { ascending: true })
    .order("real", { ascending: true });
  return (data ?? []) as Level[];
}

/**
 * Club-scoped levels with global fallback.
 * Returns club-specific rows when the club has customized its set;
 * falls back to global (club_id IS NULL) rows when not yet customized.
 */
export async function getClubLevelsAction(clubId: string): Promise<Level[]> {
  const sb = await createAdminClient();
  const { data: clubData } = await sb
    .from("levels")
    .select("*")
    .eq("club_id", clubId)
    .order("sort_order", { ascending: true })
    .order("real", { ascending: true });

  if (clubData && clubData.length > 0) {
    return clubData as Level[];
  }

  // Not customized yet — fall back to the global set (same query as getGlobalLevelsAction).
  return getGlobalLevelsAction();
}

/**
 * Resolve the club-scoped level row id to mutate. When `id` points at a global
 * fallback row (club not yet customized), materialize the club's own set first,
 * then map to the cloned row by label. Returns null if the row can't be resolved.
 */
async function resolveClubLevelTargetId(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  clubId: string,
  id: string,
): Promise<string | null> {
  const { data: target } = await sb
    .from("levels")
    .select("club_id, label")
    .eq("id", id)
    .maybeSingle();
  if (!target) return null;
  if (target.club_id != null) return id; // already a club-scoped row
  await sb.rpc("clone_global_levels_to_club", { p_club_id: clubId });
  const { data: clubRow } = await sb
    .from("levels")
    .select("id")
    .eq("club_id", clubId)
    .eq("label", target.label)
    .maybeSingle();
  return clubRow?.id ?? null;
}

/** Create a skill level scoped to a specific club. */
export async function createLevelAction(input: {
  clubId: string;
  real: number;
  label: string;
  sort_order?: number;
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  const t = await getTranslations("actions");
  if (!session || session.isGuest) return { error: t("club.requireLine") };

  const parsed = levelSchema(t("club.levelNameRequired")).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("club.invalidData") };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, input.clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  // FIX 5: Clone only when the club has no rows yet (skip if already customized).
  const { data: existingClubLevel } = await sb
    .from("levels")
    .select("id")
    .eq("club_id", input.clubId)
    .limit(1)
    .maybeSingle();
  if (!existingClubLevel) {
    await sb.rpc("clone_global_levels_to_club", { p_club_id: input.clubId });
  }

  const { error } = await sb.from("levels").insert({
    real: parsed.data.real,
    label: parsed.data.label,
    sort_order: parsed.data.sort_order ?? Math.round(parsed.data.real * 10),
    club_id: input.clubId,
  });
  if (error) {
    if (error.code === "23505") return { error: t("club.levelAlreadyExists") };
    return { error: error.message };
  }
  revalidatePath("/clubs", "layout");
  revalidatePath(`/c/${input.clubId}`);
  return { ok: true };
}

/** Edit a skill level belonging to a specific club. */
export async function updateLevelAction(input: {
  clubId: string;
  id: string;
  real: number;
  label: string;
  sort_order?: number;
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  const t = await getTranslations("actions");
  if (!session || session.isGuest) return { error: t("club.requireLine") };

  const parsed = levelSchema(t("club.levelNameRequired")).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("club.invalidData") };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, input.clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  // Resolve the row to mutate (materializes the club set on first edit of a global fallback row).
  const targetId = await resolveClubLevelTargetId(sb, input.clubId, input.id);
  if (!targetId) return { error: t("club.invalidData") };

  const { error } = await sb
    .from("levels")
    .update({
      real: parsed.data.real,
      label: parsed.data.label,
      ...(parsed.data.sort_order != null ? { sort_order: parsed.data.sort_order } : {}),
    })
    .eq("id", targetId)
    .eq("club_id", input.clubId); // scope to this club only — never touch global or other clubs
  if (error) {
    if (error.code === "23505") return { error: t("club.levelAlreadyExists") };
    return { error: error.message };
  }
  revalidatePath("/clubs", "layout");
  revalidatePath(`/c/${input.clubId}`);
  return { ok: true };
}

/**
 * Delete a skill level belonging to a specific club.
 * Players referencing it have level_id set to NULL (FK ON DELETE SET NULL).
 */
export async function deleteLevelAction(input: {
  clubId: string;
  id: string;
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  const t = await getTranslations("actions");
  if (!session || session.isGuest) return { error: t("club.requireLine") };

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, input.clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  // Resolve the row to delete (materializes the club set on first edit of a global fallback row).
  const targetId = await resolveClubLevelTargetId(sb, input.clubId, input.id);
  if (!targetId) return { error: t("club.invalidData") };

  // Guard against deleting the last level of a club (would silently revert to global + orphan players).
  const { count } = await sb
    .from("levels")
    .select("id", { count: "exact", head: true })
    .eq("club_id", input.clubId);
  if ((count ?? 0) <= 1) return { error: t("club.cannotDeleteLastLevel") };

  const { error } = await sb
    .from("levels")
    .delete()
    .eq("id", targetId)
    .eq("club_id", input.clubId); // scope to this club only
  if (error) return { error: error.message };
  revalidatePath("/clubs", "layout");
  revalidatePath(`/c/${input.clubId}`);
  return { ok: true };
}
