"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { loginRedirect, assertCanManageClub } from "@/lib/club/permissions";
import { isValidPromptPayId } from "@/lib/club/promptpay";
import { ReceiptTemplateSchema, hasBankReceiver, type ReceiptTemplate } from "@/lib/club/receipt";

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
const MAX_UPLOAD_BYTES = 1_000_000; // ~1MB, matches the club-qr bucket file_size_limit

/**
 * Shared decode → size-check → upload → public-URL body for every client-supplied
 * image that lands in the `club-qr` bucket (PromptPay QR, receipt logo, bill slip).
 * Callers own auth, the storage `path`, and any post-upload DB write.
 */
async function decodeAndUploadImage(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  path: string,
  dataUrl: string,
  invalidMsg: string,
): Promise<{ url: string } | { error: string }> {
  const m = QR_DATA_URL_RE.exec(dataUrl ?? "");
  if (!m) return { error: invalidMsg };
  const contentType = m[1];
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_UPLOAD_BYTES) {
    return { error: invalidMsg };
  }
  const up = await sb.storage.from("club-qr").upload(path, buffer, { contentType, upsert: true });
  if (up.error) return { error: up.error.message };
  const { data: pub } = sb.storage.from("club-qr").getPublicUrl(path);
  return { url: `${pub.publicUrl}?v=${Date.now()}` }; // cache-bust on replace
}

/** Owner / co-admin uploads a PromptPay QR image (alternative to a number). */
export async function uploadClubPromptPayQrAction(input: { clubId: string; dataUrl: string }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, input.clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  // One object per club (fixed path + upsert) → replacing never orphans the old file.
  const uploaded = await decodeAndUploadImage(
    sb,
    `${input.clubId}/promptpay`,
    input.dataUrl,
    t("club.invalidQrImage"),
  );
  if ("error" in uploaded) return { error: uploaded.error };

  const { error } = await sb
    .from("clubs")
    .update({ promptpay_qr_image: uploaded.url })
    .eq("id", input.clubId);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${input.clubId}`);
  return { ok: true, url: uploaded.url };
}

/** Only allow simple filename-safe keys — blocks `/` and `..` path escapes. */
function isSafeStorageKey(key: string): boolean {
  if (!key) return false;
  if (key.includes("/") || key.includes("..")) return false;
  return /^[A-Za-z0-9_.-]+$/.test(key);
}

/**
 * Owner / co-admin uploads a client-rendered bill slip PNG (replaces the server-
 * generated bare QR). `kind`/`key` pick the storage path so it overwrites the
 * exact same object the old QR-gen code used to write — no orphaned files:
 *   - kind='amount' → `${clubId}/group-bill-${key}.png` (key = amount, group flow)
 *   - kind='player' → `${clubId}/bill-${key}.png`        (key = club_players.id, 1:1 flow)
 */
export async function uploadBillSlipAction(input: {
  clubId: string;
  kind: "amount" | "player";
  key: string;
  dataUrl: string;
}): Promise<{ ok: true; url: string } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, input.clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  if (!isSafeStorageKey(input.key)) {
    return { error: t("club.invalidData") };
  }

  // Reuses the exact path the old server-side QR-gen wrote to — upsert overwrites
  // the bare QR in place, so no orphaned objects are left in the bucket.
  const path =
    input.kind === "amount"
      ? `${input.clubId}/group-bill-${input.key}.png`
      : `${input.clubId}/bill-${input.key}.png`;

  const uploaded = await decodeAndUploadImage(sb, path, input.dataUrl, t("club.invalidSlipImage"));
  if ("error" in uploaded) return { error: uploaded.error };
  return { ok: true, url: uploaded.url };
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

// ---------------------------------------------------------------------------
// Receipt template (#11/#12) — owner/co-admin customizes the payment slip
// ---------------------------------------------------------------------------

/**
 * Owner / co-admin saves the club's receipt customization. Full-replace write (mirrors
 * `updatePrizeTemplateAction`): the editor sends the whole object, `safeParse` enforces
 * the schema, the column is overwritten wholesale. No jsonb merge.
 */
export async function updateClubReceiptTemplateAction(clubId: string, template: ReceiptTemplate) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const parsed = ReceiptTemplateSchema.safeParse(template);
  if (!parsed.success) return { error: t("club.invalidData") };

  // Don't trust client-side validation: enabling the bank channel requires a usable
  // receiver (bank name + account number), else the slip silently renders nothing.
  if (parsed.data.payment_show.bank && !hasBankReceiver(parsed.data.bank)) {
    return { error: t("club.invalidData") };
  }

  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  const { error } = await sb
    .from("clubs")
    .update({ receipt_template: parsed.data })
    .eq("id", clubId);
  if (error) return { error: error.message };

  await sb.from("club_audit_logs").insert({
    club_id: clubId,
    actor_id: session.profileId,
    actor_name: null,
    event_type: "receipt_template_updated",
    detail: `footer ${parsed.data.footer_note ? "set" : "none"}; bank ${parsed.data.payment_show.bank ? "on" : "off"}; theme ${parsed.data.theme}`,
  });

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true, template: parsed.data };
}

/**
 * Owner / co-admin uploads the club receipt header logo (shown on the slip in place of
 * the 🏸 emoji). Mirrors `uploadClubPromptPayQrAction` — same validation + `club-qr`
 * bucket, fixed path `{clubId}/receipt-logo` + upsert so replacing never orphans.
 */
export async function uploadClubReceiptLogoAction(input: { clubId: string; dataUrl: string }) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, input.clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  const uploaded = await decodeAndUploadImage(
    sb,
    `${input.clubId}/receipt-logo`,
    input.dataUrl,
    t("club.invalidQrImage"),
  );
  if ("error" in uploaded) return { error: uploaded.error };

  const { error } = await sb
    .from("clubs")
    .update({ receipt_logo_url: uploaded.url })
    .eq("id", input.clubId);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${input.clubId}`);
  return { ok: true, url: uploaded.url };
}

/** Owner / co-admin removes the uploaded receipt logo. */
export async function removeClubReceiptLogoAction(clubId: string) {
  const session = await getSession();
  if (!session) return await loginRedirect();

  const t = await getTranslations("actions");
  const sb = await createAdminClient();
  if (!(await assertCanManageClub(sb, clubId, session.profileId))) {
    return { error: t("club.noPermission") };
  }

  await sb.storage.from("club-qr").remove([`${clubId}/receipt-logo`]); // best-effort
  const { error } = await sb.from("clubs").update({ receipt_logo_url: null }).eq("id", clubId);
  if (error) return { error: error.message };

  revalidatePath(`/clubs/${clubId}`);
  return { ok: true };
}
