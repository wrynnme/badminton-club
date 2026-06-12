"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession, setSession } from "@/lib/auth/session";
import { DisplayNameSchema, type UpdateProfileInput } from "@/lib/validation/profile";

/**
 * Self-service display-name change for the logged-in user (LINE or guest). Updates
 * profiles.display_name, then RE-ISSUES the session cookie via setSession so the
 * header (which reads displayName from the cookie, not the DB) shows the new name
 * immediately. Does not bump session_version, so other devices stay logged in.
 */
export async function updateProfileDisplayNameAction(input: UpdateProfileInput) {
  const session = await getSession();
  const t = await getTranslations("actions");
  if (!session) return { error: t("tournament.requireLogin") };

  const parsed = DisplayNameSchema.safeParse(input);
  if (!parsed.success) {
    return { error: t("tournament.invalidInput") };
  }
  const display_name = parsed.data.display_name;

  const sb = await createAdminClient();
  const { error } = await sb
    .from("profiles")
    .update({ display_name })
    .eq("id", session.profileId);
  if (error) {
    console.error("updateProfileDisplayNameAction failed", error);
    return { error: t("tournament.profileSaveFailed") };
  }

  await setSession({
    profileId: session.profileId,
    displayName: display_name,
    pictureUrl: session.pictureUrl,
    isGuest: session.isGuest,
  });

  revalidatePath("/settings");
  return { ok: true as const };
}
