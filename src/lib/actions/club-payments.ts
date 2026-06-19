"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { loginRedirect, assertCanManageClub } from "@/lib/club/permissions";
import { isValidPromptPayId } from "@/lib/club/promptpay";
import {
  BillingVerifyModeSchema,
  SlipProviderSchema,
  ClubBillingVerifySettingsSchema,
} from "@/lib/club/billing-verify-settings";

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

// ---------------------------------------------------------------------------
// Billing verify settings
// ---------------------------------------------------------------------------

const BillingVerifySettingsInputSchema = z.object({
  mode: BillingVerifyModeSchema,
  provider: SlipProviderSchema.nullable().optional(),
  branchId: z.string().trim().max(64).nullable().optional(),
  /**
   * API key — only present when the owner is setting/rotating the key.
   * Omitting it means "keep existing key unchanged".
   * Sending an empty string is treated as omitted (no-op for the key).
   */
  apiKey: z.string().trim().max(512).nullable().optional(),
});

export type BillingVerifySettingsInput = z.infer<typeof BillingVerifySettingsInputSchema>;

/**
 * Owner / co-admin sets the per-club slip-verification mode.
 *
 * - mode=manual : clears any stored api_key (row deleted from club_billing_secrets)
 *                 and resets provider/branch_id to null.
 * - mode=byok   : must supply provider; slipok must supply branchId;
 *                 if apiKey is provided it is upserted into club_billing_secrets;
 *                 if apiKey is absent the existing key is kept (no-op for the key).
 *                 If byok is set for the first time and no apiKey is supplied → error.
 *
 * The api_key value is NEVER returned to the client or written to audit logs.
 */
export async function updateClubBillingVerifySettingsAction(
  clubId: string,
  input: BillingVerifySettingsInput,
) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();

  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  const parsed = BillingVerifySettingsInputSchema.safeParse(input);
  if (!parsed.success) return { error: t("club.billingVerifyInvalidData") };

  const { mode, provider, branchId, apiKey } = parsed.data;
  const trimmedKey = apiKey?.trim() || null;

  // ---- mode-specific validation + secret write; derive key_set locally ----
  let keySet: boolean;

  if (mode === "byok") {
    if (!provider) return { error: t("club.billingVerifyByokNeedsProvider") };
    if (provider === "slipok" && !branchId) {
      return { error: t("club.billingVerifySlipOkNeedsBranch") };
    }

    if (trimmedKey) {
      // Set / rotate the key.
      const { error: secretError } = await sb
        .from("club_billing_secrets")
        .upsert(
          { club_id: clubId, api_key: trimmedKey, updated_at: new Date().toISOString() },
          { onConflict: "club_id" },
        );
      if (secretError) return { error: t("club.billingVerifySaveFailed") };
    } else {
      // No new key supplied — an existing one must already be stored.
      const { data: existingSecret } = await sb
        .from("club_billing_secrets")
        .select("club_id")
        .eq("club_id", clubId)
        .maybeSingle();
      if (!existingSecret) return { error: t("club.billingVerifyByokNeedsKey") };
    }
    keySet = true;
  } else {
    // mode === "manual": delete any stored key (don't leave stale credentials).
    await sb.from("club_billing_secrets").delete().eq("club_id", clubId);
    keySet = false;
  }

  // ---- Build + validate the full settings object ----
  // All four fields are set here, so there is nothing to merge from the
  // existing row; parse() enforces the schema before the write.
  const next = ClubBillingVerifySettingsSchema.parse({
    mode,
    provider: mode === "byok" ? (provider ?? null) : null,
    branch_id: mode === "byok" && provider === "slipok" ? (branchId ?? null) : null,
    key_set: keySet,
  });

  const { error: updateError } = await sb
    .from("clubs")
    .update({ billing_verify_settings: next })
    .eq("id", clubId);

  if (updateError) return { error: t("club.billingVerifySaveFailed") };

  // ---- Audit log — never log the api_key value ----
  const keyStatus = trimmedKey ? "set" : mode === "manual" ? "cleared" : "unchanged";
  await sb.from("club_audit_logs").insert({
    club_id: clubId,
    actor_id: session.profileId,
    actor_name: null,
    event_type: "billing_verify_config_changed",
    detail: `mode ${mode}; provider ${provider ?? "none"}; key ${keyStatus}`,
  });

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
