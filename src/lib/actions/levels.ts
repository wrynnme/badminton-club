"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
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

/** Public read — levels list ordered for display. */
export async function getLevelsAction(): Promise<Level[]> {
  const sb = await createAdminClient();
  const { data } = await sb
    .from("levels")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("real", { ascending: true });
  return (data ?? []) as Level[];
}

/** Create a skill level (any signed-in LINE user; global reference data). */
export async function createLevelAction(input: {
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
  const { error } = await sb.from("levels").insert({
    real: parsed.data.real,
    label: parsed.data.label,
    sort_order: parsed.data.sort_order ?? Math.round(parsed.data.real * 10),
  });
  if (error) {
    if (error.code === "23505") return { error: t("club.levelAlreadyExists") };
    return { error: error.message };
  }
  revalidatePath("/clubs", "layout");
  return { ok: true };
}

/** Edit a skill level. */
export async function updateLevelAction(input: {
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
  const { error } = await sb
    .from("levels")
    .update({
      real: parsed.data.real,
      label: parsed.data.label,
      ...(parsed.data.sort_order != null ? { sort_order: parsed.data.sort_order } : {}),
    })
    .eq("id", input.id);
  if (error) {
    if (error.code === "23505") return { error: t("club.levelAlreadyExists") };
    return { error: error.message };
  }
  revalidatePath("/clubs", "layout");
  return { ok: true };
}

/** Delete a skill level. Players referencing it have level_id set to NULL (FK ON DELETE SET NULL). */
export async function deleteLevelAction(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  const t = await getTranslations("actions");
  if (!session || session.isGuest) return { error: t("club.requireLine") };

  const sb = await createAdminClient();
  const { error } = await sb.from("levels").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/clubs", "layout");
  return { ok: true };
}
