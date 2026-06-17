"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { loginRedirect, assertCanManageClub } from "@/lib/club/permissions";
import { isValidPromptPayId } from "@/lib/club/promptpay";

const PaymentConfigSchema = z.object({
  promptpay_id: z.string().trim().max(40).nullable().optional(),
  promptpay_name: z.string().trim().max(80).nullable().optional(),
});
export type PaymentConfigInput = z.infer<typeof PaymentConfigSchema>;

/** Owner / co-admin sets the club's PromptPay receiver (number + display name). */
export async function updateClubPaymentConfigAction(clubId: string, input: PaymentConfigInput) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const parsed = PaymentConfigSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.invalidData") };

  // Empty string clears the field (→ null). A non-empty proxy id must be a valid
  // PromptPay target (mobile / national id / e-wallet).
  const promptpay_id = parsed.data.promptpay_id?.trim() || null;
  const promptpay_name = parsed.data.promptpay_name?.trim() || null;
  if (promptpay_id && !isValidPromptPayId(promptpay_id)) {
    return { error: t("club.invalidPromptPay") };
  }

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  const { error } = await sb
    .from("clubs")
    .update({ promptpay_id, promptpay_name })
    .eq("id", clubId);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

/** Owner / co-admin flips one player's paid status (records / clears `paid_at`). */
export async function toggleClubPlayerPaidAction(input: { clubId: string; playerId: string }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, input.clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  const { data: player } = await sb
    .from("club_players")
    .select("paid_at")
    .eq("id", input.playerId)
    .eq("club_id", input.clubId)
    .maybeSingle();
  if (!player) return { error: t("club.invalidData") };

  const next = player.paid_at ? null : new Date().toISOString();
  const { error } = await sb
    .from("club_players")
    .update({ paid_at: next })
    .eq("id", input.playerId)
    .eq("club_id", input.clubId);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${input.clubId}`);
  return { ok: true, paid: next !== null };
}

const QR_DATA_URL_RE = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_QR_BYTES = 1_000_000; // ~1MB, matches the club-qr bucket file_size_limit

/** Owner / co-admin uploads a PromptPay QR image (alternative to a number). */
export async function uploadClubPromptPayQrAction(input: { clubId: string; dataUrl: string }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, input.clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  const m = QR_DATA_URL_RE.exec(input.dataUrl ?? "");
  if (!m) return { error: t("club.invalidQrImage") };
  const contentType = m[1];
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_QR_BYTES) {
    return { error: t("club.invalidQrImage") };
  }

  // One object per club (fixed path + upsert) → replacing never orphans the old file.
  const path = `${input.clubId}/promptpay`;
  const up = await sb.storage.from("club-qr").upload(path, buffer, { contentType, upsert: true });
  if (up.error) return { error: up.error.message };

  const { data: pub } = sb.storage.from("club-qr").getPublicUrl(path);
  const url = `${pub.publicUrl}?v=${Date.now()}`; // cache-bust on replace
  const { error } = await sb.from("clubs").update({ promptpay_qr_image: url }).eq("id", input.clubId);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${input.clubId}`);
  return { ok: true, url };
}

/** Owner / co-admin removes the uploaded PromptPay QR image. */
export async function removeClubPromptPayQrAction(clubId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  await sb.storage.from("club-qr").remove([`${clubId}/promptpay`]); // best-effort
  const { error } = await sb.from("clubs").update({ promptpay_qr_image: null }).eq("id", clubId);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}

/** Owner / co-admin clears every player's paid status (start a fresh collection round). */
export async function resetAllPaidAction(clubId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  // Idempotent: only touch rows that are currently marked paid.
  const { error } = await sb
    .from("club_players")
    .update({ paid_at: null })
    .eq("club_id", clubId)
    .not("paid_at", "is", null);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}
