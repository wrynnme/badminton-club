import { z } from "zod";
import {
  ReceiptBankSchema,
  ReceiptPaymentShowSchema,
  ReceiptThemeSchema,
  DEFAULT_RECEIPT_TEMPLATE,
} from "@/lib/club/receipt";

/**
 * Saved config for a ClubPreset. Stored on `club_presets.config jsonb`.
 *
 * Fields mirror the clubs creation form so applying a preset can seed a new
 * club row without prompting the user for these details again.
 *
 *  venue            สนาม (free text)
 *  schedule_day     display metadata only — e.g. "พุธ", not a DB date
 *  start_time       "HH:MM" — club session start
 *  end_time         "HH:MM" — club session end
 *  max_players      2–40 (cap for 'active' vs 'reserve' split)
 *  court_fee        total court hire cost (numeric ≥ 0)
 *  shuttle_price    price per shuttle (numeric ≥ 0)
 *  court_count      1–20 — used to generate courts array ["1".."N"]
 *  players_per_team 1 = เดี่ยว, 2 = คู่
 *  rotation_mode    fair_queue | winner_stays | fair_winner_fallback
 *  queue_mode       rest_longest | fifo | level_match | smart
 *  co_admin_ids     profile UUIDs to add as club_admins on apply
 *  regulars         seed club_players on apply (D4 decision: name + optional link)
 *  payment receiver PromptPay/bank receiver + receipt channel/theme defaults
 */

export const ClubPresetReceiptTemplateSchema = z.object({
  bank: ReceiptBankSchema.default(DEFAULT_RECEIPT_TEMPLATE.bank),
  payment_show: ReceiptPaymentShowSchema.default(DEFAULT_RECEIPT_TEMPLATE.payment_show),
  theme: ReceiptThemeSchema.default(DEFAULT_RECEIPT_TEMPLATE.theme),
});
export type ClubPresetReceiptTemplate = z.infer<typeof ClubPresetReceiptTemplateSchema>;

export const ClubPresetConfigSchema = z.object({
  venue: z.string().default(""),
  schedule_day: z.string().default(""),
  start_time: z.string().default(""),
  end_time: z.string().default(""),
  max_players: z.number().int().min(2).max(40).default(12),
  court_fee: z.number().min(0).default(0),
  shuttle_price: z.number().min(0).default(0),
  court_count: z.number().int().min(1).max(20).default(1),
  players_per_team: z.union([z.literal(1), z.literal(2)]).default(2),
  rotation_mode: z.enum(["fair_queue", "winner_stays", "fair_winner_fallback"]).default("fair_queue"),
  queue_mode: z.enum(["rest_longest", "fifo", "level_match", "smart"]).default("rest_longest"),
  co_admin_ids: z.array(z.string()).default([]),
  promptpay_id: z.string().trim().max(40).nullable().default(null),
  promptpay_name: z.string().trim().max(80).nullable().default(null),
  promptpay_qr_image: z.string().trim().max(2048).nullable().default(null),
  receipt_template: ClubPresetReceiptTemplateSchema.default({
    bank: DEFAULT_RECEIPT_TEMPLATE.bank,
    payment_show: DEFAULT_RECEIPT_TEMPLATE.payment_show,
    theme: DEFAULT_RECEIPT_TEMPLATE.theme,
  }),
  regulars: z
    .array(
      z.object({
        name: z.string().min(1),
        profile_id: z.string().uuid().nullable().optional(),
        start_time: z.string().nullable().optional(),
        end_time: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

export type ClubPresetConfig = z.infer<typeof ClubPresetConfigSchema>;

export const DEFAULT_PRESET_CONFIG: ClubPresetConfig = ClubPresetConfigSchema.parse({});

function recoverPresetReceiptTemplate(value: unknown): ClubPresetReceiptTemplate {
  const fast = ClubPresetReceiptTemplateSchema.safeParse(value);
  if (fast.success) return fast.data;
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_PRESET_CONFIG.receipt_template;
  }

  const rec = value as Record<string, unknown>;
  const out: ClubPresetReceiptTemplate = {
    bank: DEFAULT_PRESET_CONFIG.receipt_template.bank,
    payment_show: DEFAULT_PRESET_CONFIG.receipt_template.payment_show,
    theme: DEFAULT_PRESET_CONFIG.receipt_template.theme,
  };

  if ("bank" in rec) {
    const parsed = ReceiptBankSchema.safeParse(rec.bank);
    if (parsed.success) out.bank = parsed.data;
  }
  if ("payment_show" in rec) {
    const parsed = ReceiptPaymentShowSchema.safeParse(rec.payment_show);
    if (parsed.success) out.payment_show = parsed.data;
  }
  if ("theme" in rec) {
    const parsed = ReceiptThemeSchema.safeParse(rec.theme);
    if (parsed.success) out.theme = parsed.data;
  }

  return out;
}

/**
 * Per-field tolerant parse: if the whole-object parse succeeds, return it
 * directly. Otherwise, attempt to parse each field individually and fall back
 * to the default for fields that fail. Defends against partial/legacy jsonb
 * rows from manual DB edits or future schema evolution.
 *
 * The `regulars` array is parsed as a whole (all-or-nothing per entry) because
 * a half-constructed regular record has no safe default.
 */
export function parsePresetConfig(raw: unknown): ClubPresetConfig {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_PRESET_CONFIG;
  }

  const fast = ClubPresetConfigSchema.safeParse(raw);
  if (fast.success) return fast.data;

  const out: ClubPresetConfig = { ...DEFAULT_PRESET_CONFIG };
  const shape = ClubPresetConfigSchema.shape;
  const rec = raw as Record<string, unknown>;

  for (const key of Object.keys(shape) as Array<keyof typeof shape>) {
    if (!(key in rec)) continue;
    if (key === "receipt_template") {
      out.receipt_template = recoverPresetReceiptTemplate(rec[key]);
      continue;
    }
    const parsed = shape[key].safeParse(rec[key]);
    if (parsed.success) {
      (out as Record<string, unknown>)[key] = parsed.data;
    }
  }

  return out;
}
