import type { Club, ClubSeries } from "@/lib/types";

/**
 * series-payment.ts — pure resolve helpers for ADR 0002 P3 ("lift promptpay/
 * receipt config to the series"): series-first, per-field fallback to the
 * legacy per-session `clubs` columns during the EXPAND/CONTRACT transition
 * (legacy columns stay readable until CONTRACT — see docs/adr/0002).
 *
 * Deliberately has NO server-only dependency (mirrors `session-defaults.ts` —
 * moved out of `series.server.ts` for the same reason: importing that file
 * pulls in `@/lib/supabase/server`'s `import "server-only"`, which throws at
 * import time in a vitest node-environment test). Safe to import from both RSC
 * pages/actions (server-side resolve) and unit tests.
 */

export type ResolvedPaymentConfig = {
  promptpay_id: string | null;
  promptpay_name: string | null;
  promptpay_qr_image: string | null;
};

type PaymentSeriesInput = Pick<
  ClubSeries,
  "promptpay_id" | "promptpay_name" | "promptpay_qr_image"
> | null;
type PaymentClubInput = Pick<Club, "promptpay_id" | "promptpay_name" | "promptpay_qr_image">;

/**
 * Series-first, per-field fallback to the legacy per-session columns. Per-field
 * (not whole-object) so a series that only ever set `promptpay_name` (not
 * `promptpay_id`) still falls back to the club's own id instead of a partial
 * series config masking a working legacy value with `null`.
 */
export function resolvePaymentConfig(
  series: PaymentSeriesInput,
  club: PaymentClubInput,
): ResolvedPaymentConfig {
  return {
    promptpay_id: series?.promptpay_id ?? club.promptpay_id,
    promptpay_name: series?.promptpay_name ?? club.promptpay_name,
    promptpay_qr_image: series?.promptpay_qr_image ?? club.promptpay_qr_image,
  };
}

export type ResolvedReceiptConfig = {
  receipt_template: Record<string, unknown>;
  receipt_logo_url: string | null;
};

type ReceiptSeriesInput = Pick<ClubSeries, "receipt_template" | "receipt_logo_url"> | null;
type ReceiptClubInput = Pick<Club, "receipt_template" | "receipt_logo_url">;

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

/**
 * Series-first: the series' `receipt_template` wins whenever it's a non-empty
 * object — an unset series stays `{}` (the migration's column default) and must
 * NOT shadow a real legacy customization on the club row. `receipt_logo_url` is
 * a plain nullable field, so a simple `??` fallback is unambiguous (no "unset
 * vs. empty" distinction to make, unlike the jsonb template).
 */
export function resolveReceiptConfig(
  series: ReceiptSeriesInput,
  club: ReceiptClubInput,
): ResolvedReceiptConfig {
  const seriesTemplate = series?.receipt_template;
  return {
    receipt_template: isNonEmptyObject(seriesTemplate) ? seriesTemplate : club.receipt_template,
    receipt_logo_url: series?.receipt_logo_url ?? club.receipt_logo_url,
  };
}
