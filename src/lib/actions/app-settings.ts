"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { loginRedirect } from "@/lib/club/permissions";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import {
  BOT_MESSAGE_KEYS,
  missingRequiredPlaceholders,
  type BotMessageKey,
} from "@/lib/bot-messages";

const QR_DATA_URL_RE = /^data:(image\/(?:png|jpe?g|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/;
const MAX_LOGO_BYTES = 1_000_000; // ~1MB, matches the app-assets bucket limit

/** Toggle the global centre-of-QR logo on/off (site owner only). */
export async function setQrLogoEnabledAction(enabled: boolean) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (!(await isSiteAdmin())) return { error: t("admin.notSiteAdmin") };

  const sb = await createAdminClient();
  const { error } = await sb
    .from("app_settings")
    .update({ qr_logo_enabled: enabled, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

/** Replace the global QR logo with an uploaded image (site owner only). */
export async function uploadQrLogoAction(input: { dataUrl: string }) {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (!(await isSiteAdmin())) return { error: t("admin.notSiteAdmin") };

  const m = QR_DATA_URL_RE.exec(input.dataUrl ?? "");
  if (!m) return { error: t("admin.invalidImage") };
  const contentType = m[1];
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_LOGO_BYTES) {
    return { error: t("admin.invalidImage") };
  }

  // An SVG logo is served from a public bucket URL; the on-screen <img> render
  // path won't execute its script, but opening the bucket URL directly would.
  // Reject anything scriptable. Site-admin-only upload, so a pattern gate is
  // enough without pulling in a full SVG sanitizer dependency.
  if (contentType === "image/svg+xml") {
    const svg = buffer.toString("utf8");
    // NB: <style> and <use> are intentionally NOT rejected — they're legitimate
    // in ordinary logo SVGs (the Kuanbad mark uses <style> for its fill colors).
    // We reject only active-content vectors + external CSS pulls (@import).
    if (
      /<script[\s>]/i.test(svg) ||
      /\son\w+\s*=/i.test(svg) ||
      /javascript:/i.test(svg) ||
      /@import/i.test(svg) ||
      /<foreignObject[\s>]/i.test(svg)
    ) {
      return { error: t("admin.unsafeSvg") };
    }
  }

  const sb = await createAdminClient();
  const path = "qr-logo/logo"; // one global object, upsert → no orphans
  const up = await sb.storage.from("app-assets").upload(path, buffer, { contentType, upsert: true });
  if (up.error) return { error: up.error.message };

  const { data: pub } = sb.storage.from("app-assets").getPublicUrl(path);
  const url = `${pub.publicUrl}?v=${Date.now()}`; // cache-bust on replace
  const { error } = await sb
    .from("app_settings")
    .update({ qr_logo_url: url, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { error: error.message };

  revalidatePath("/admin");
  return { ok: true, url };
}

/** Clear the custom QR logo, reverting to the bundled default (site owner only). */
export async function removeQrLogoAction() {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (!(await isSiteAdmin())) return { error: t("admin.notSiteAdmin") };

  const sb = await createAdminClient();
  await sb.storage.from("app-assets").remove(["qr-logo/logo"]); // best-effort
  const { error } = await sb
    .from("app_settings")
    .update({ qr_logo_url: null, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Replace the site-admin overrides for the bot's automated LINE messages
 * (site owner only). A blank value for a key clears that override (the message
 * falls back to its code default); a non-blank value must keep every REQUIRED
 * placeholder for that message, else the save is rejected naming the culprit.
 */
export async function updateBotMessagesAction(input: {
  messages: Partial<Record<BotMessageKey, string>>;
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) return await loginRedirect();
  const t = await getTranslations("actions");
  if (!(await isSiteAdmin())) return { error: t("admin.notSiteAdmin") };

  // Build a clean override map: only known keys with a non-blank value survive.
  // Each survivor must keep its required placeholders (server-side backstop for
  // the client editor's own validation).
  const clean: Partial<Record<BotMessageKey, string>> = {};
  for (const key of BOT_MESSAGE_KEYS) {
    const raw = input.messages?.[key];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue; // blank → clear override (use default)
    const missing = missingRequiredPlaceholders(key, trimmed);
    if (missing.length > 0) {
      return { error: t("admin.messagePlaceholderMissing", { key, missing: missing.join(", ") }) };
    }
    clean[key] = trimmed;
  }

  const sb = await createAdminClient();
  const { error } = await sb
    .from("app_settings")
    .update({ messages: clean, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}
