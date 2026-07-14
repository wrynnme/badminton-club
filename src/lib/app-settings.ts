import { createAdminClient } from "@/lib/supabase/server";
import { parseBotMessages } from "@/lib/bot-messages";
import type { AppSettings } from "@/lib/types";

/** Bundled fallback logo (public/) used when no custom logo is uploaded. */
export const DEFAULT_QR_LOGO = "/thaiqr-logo.png";

const DEFAULTS: AppSettings = { qr_logo_enabled: true, qr_logo_url: null, messages: {} };

/** Read the global app settings (singleton row id=1). Server-only. */
export async function getAppSettings(): Promise<AppSettings> {
  const sb = await createAdminClient();
  const { data } = await sb
    .from("app_settings")
    .select("qr_logo_enabled, qr_logo_url, messages")
    .eq("id", 1)
    .maybeSingle();
  if (!data) return DEFAULTS;
  return {
    qr_logo_enabled: data.qr_logo_enabled,
    qr_logo_url: data.qr_logo_url,
    // Tolerant parse — keeps only known keys with non-blank string overrides.
    messages: parseBotMessages(data.messages),
  };
}

/**
 * Resolve the centre-of-QR logo URL from settings: a custom uploaded logo, the
 * bundled default, or `null` when the site owner has turned the logo off.
 */
export function resolveQrLogoUrl(settings: AppSettings): string | null {
  if (!settings.qr_logo_enabled) return null;
  return settings.qr_logo_url || DEFAULT_QR_LOGO;
}
