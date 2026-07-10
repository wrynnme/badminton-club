import { z } from "zod";
import {
  ReceiptBankSchema,
  ReceiptPaymentShowSchema,
  ReceiptThemeSchema,
  DEFAULT_RECEIPT_TEMPLATE,
  parseReceiptTemplate,
} from "@/lib/club/receipt";
import {
  ClubQueueSettingsSchema,
  DEFAULT_QUEUE_SETTINGS,
  normalizeLegacyQueueValues,
  parseQueueSettings,
} from "@/lib/club/queue-settings";

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
 *  queue_settings   full ClubQueueSettings block (single source of truth) — every
 *                   queue field round-trips through save→apply→edit, not just the
 *                   four that used to be captured. skill_level_enabled is NOT stored;
 *                   parseQueueSettings derives it from queue_mode on read. Presets
 *                   written before this (flat court_count/players_per_team/
 *                   rotation_mode/queue_mode, no nested block) are folded in
 *                   parsePresetConfig before the schema parse.
 *  courts           named courts (e.g. ["คอร์ท A","สนาม VIP"]); applyClubPresetAction
 *                   seeds clubs.courts from it, falling back to ["1".."court_count"]
 *                   only when empty (old presets). queue_settings.court_count stays
 *                   as the frozen legacy fallback.
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
  queue_settings: ClubQueueSettingsSchema.default(DEFAULT_QUEUE_SETTINGS),
  courts: z.array(z.string()).default([]),
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
  // Delegate to the receipt module's tolerant parser so preset recovery can
  // never drift from how clubs.receipt_template itself is recovered.
  const { bank, payment_show, theme } = parseReceiptTemplate(value);
  return { bank, payment_show, theme };
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

  // Legacy value translation (queue_mode "smart" → "level_match") via the shared
  // helper so it can't drift from parseQueueSettings.
  const rec = normalizeLegacyQueueValues({ ...(raw as Record<string, unknown>) });

  // Normalize the queue block through parseQueueSettings BEFORE the schema parse
  // so every read path returns a consistent object — parseQueueSettings is the
  // single source of the derived coupling (mirrors how the club itself is read):
  // it derives skill_level_enabled from queue_mode when absent, folds legacy
  // values, and fills the newer fields with behavior-preserving defaults. Two
  // cases: a nested block is normalized in place; a legacy preset (four queue
  // fields flat, no nested block) is synthesized from those flat keys. Skipping
  // this and relying on the schema's `.default()` would (a) wipe a legacy preset's
  // stored mode and (b) leave skill_level_enabled at its raw default `false` on a
  // level_match block that omitted the flag. No DB migration (zod strips the
  // now-unknown flat keys).
  rec.queue_settings =
    "queue_settings" in rec
      ? parseQueueSettings(rec.queue_settings)
      : parseQueueSettings({
          court_count: rec.court_count,
          players_per_team: rec.players_per_team,
          rotation_mode: rec.rotation_mode,
          queue_mode: rec.queue_mode,
        });

  const fast = ClubPresetConfigSchema.safeParse(rec);
  if (fast.success) return fast.data;

  const out: ClubPresetConfig = { ...DEFAULT_PRESET_CONFIG };
  const shape = ClubPresetConfigSchema.shape;

  for (const key of Object.keys(shape) as Array<keyof typeof shape>) {
    if (!(key in rec)) continue;
    if (key === "receipt_template") {
      out.receipt_template = recoverPresetReceiptTemplate(rec[key]);
      continue;
    }
    if (key === "queue_settings") {
      // parseQueueSettings is itself tolerant (per-field fallback) and derives
      // skill_level_enabled — recover through it rather than the ZodDefault wrapper.
      out.queue_settings = parseQueueSettings(rec[key]);
      continue;
    }
    const parsed = shape[key].safeParse(rec[key]);
    if (parsed.success) {
      (out as Record<string, unknown>)[key] = parsed.data;
    }
  }

  return out;
}
