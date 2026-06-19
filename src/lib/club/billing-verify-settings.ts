import { z } from "zod";

/**
 * billing-verify-settings.ts — per-club slip-verification config.
 *
 * Stored on `clubs.billing_verify_settings jsonb` (same pattern as queue_settings).
 * New fields can be added without a migration — parse via parseBillingVerifySettings().
 *
 * Modes:
 *   manual (default) — slip goes into a review queue; owner confirms manually.
 *   byok             — club supplies its own provider + API key via club_billing_secrets;
 *                      slip is auto-verified using the club's own credentials.
 *
 * The `key_set` flag mirrors whether a row exists in club_billing_secrets so UI can show
 * "key configured" without ever reading the key value.
 *
 * Deprecated env vars (no longer read by any code):
 *   SLIP_VERIFY_PROVIDER, SLIP_VERIFY_API_KEY, SLIP_VERIFY_SLIPOK_BRANCH_ID
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const BillingVerifyModeSchema = z.enum(["manual", "byok"]);
export type BillingVerifyMode = z.infer<typeof BillingVerifyModeSchema>;

export const SlipProviderSchema = z.enum(["easyslip", "slipok"]);
export type SlipProvider = z.infer<typeof SlipProviderSchema>;

export const ClubBillingVerifySettingsSchema = z.object({
  /** Verification mode. "manual" = no automatic verify; "byok" = use club's own key. */
  mode: BillingVerifyModeSchema.default("manual"),
  /** Provider name — only meaningful when mode === "byok". */
  provider: SlipProviderSchema.nullable().default(null),
  /** SlipOK only: branch_id appears in the URL path (api.slipok.com/api/line/apikey/<branchId>). */
  branch_id: z.string().trim().max(64).nullable().default(null),
  /**
   * Mirror flag: true = a row exists in club_billing_secrets for this club.
   * Written by the server action; never trusted as the authoritative check — the action
   * always re-queries club_billing_secrets to determine the real key status.
   */
  key_set: z.boolean().default(false),
});

export type ClubBillingVerifySettings = z.infer<typeof ClubBillingVerifySettingsSchema>;

export const DEFAULT_BILLING_VERIFY_SETTINGS: ClubBillingVerifySettings =
  ClubBillingVerifySettingsSchema.parse({});

// ---------------------------------------------------------------------------
// Parse helper — per-field fallback (mirrors parseQueueSettings)
// ---------------------------------------------------------------------------

/**
 * Parse raw jsonb from `clubs.billing_verify_settings`.
 *
 * Per-field fallback: if the whole-object parse fails (e.g. partial corruption from an
 * older schema), keep any field that parses individually rather than dropping everything.
 * Unknown / extra keys from future schema versions are silently ignored.
 */
export function parseBillingVerifySettings(raw: unknown): ClubBillingVerifySettings {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_BILLING_VERIFY_SETTINGS;
  }

  const fast = ClubBillingVerifySettingsSchema.safeParse(raw);
  if (fast.success) return fast.data;

  const out: ClubBillingVerifySettings = { ...DEFAULT_BILLING_VERIFY_SETTINGS };
  const shape = ClubBillingVerifySettingsSchema.shape;
  const rec = raw as Record<string, unknown>;

  for (const key of Object.keys(shape) as Array<keyof typeof shape>) {
    if (!(key in rec)) continue;
    const parsed = shape[key].safeParse(rec[key]);
    if (parsed.success) {
      (out as Record<string, unknown>)[key] = parsed.data;
    }
  }
  return out;
}
