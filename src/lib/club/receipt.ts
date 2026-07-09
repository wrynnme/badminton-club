import { z } from "zod";

/**
 * Receipt template — owner-configured presentation + payment config for the club
 * payment slip (#11/#12). Stored on the standalone `clubs.receipt_template jsonb`
 * column (mirrors `tournaments.prize_template`, NOT inside `queue_settings`).
 * Validated app-side by `ReceiptTemplateSchema`.
 *
 * Default `'{}'` (unset) → `parseReceiptTemplate` returns `DEFAULT_RECEIPT_TEMPLATE`,
 * which reproduces today's slip exactly (all line items shown, PromptPay only, no
 * footer note, default green theme).
 *
 * v1 wires: `footer_note`, `fields`, `bank` (#12a text), `payment_show`.
 * v2 wires (schema present now so the jsonb shape is stable): `theme`, `bank_qr`.
 */

export const ReceiptThemeSchema = z.enum(["green", "blue", "rose", "slate", "amber", "violet"]);
export type ReceiptThemeKey = z.infer<typeof ReceiptThemeSchema>;
export const RECEIPT_THEME_KEYS = ReceiptThemeSchema.options;

/** Which itemized rows appear on the slip. `total` is always shown (not toggleable). */
export const ReceiptFieldsSchema = z.object({
  court: z.boolean().default(true),
  shuttle: z.boolean().default(true),
  expense: z.boolean().default(true),
  discount: z.boolean().default(true),
});
export type ReceiptFields = z.infer<typeof ReceiptFieldsSchema>;

/** Bank-account receiver (#12a) — shown as plain text on the slip. */
export const ReceiptBankSchema = z.object({
  name: z.string().trim().max(60).default(""),
  account_no: z.string().trim().max(40).default(""),
  account_name: z.string().trim().max(80).default(""),
});
export type ReceiptBank = z.infer<typeof ReceiptBankSchema>;

/** Which payment channels to render on the slip. */
export const ReceiptPaymentShowSchema = z.object({
  promptpay: z.boolean().default(true),
  bank: z.boolean().default(false),
});
export type ReceiptPaymentShow = z.infer<typeof ReceiptPaymentShowSchema>;

export const ReceiptTemplateSchema = z.object({
  footer_note: z.string().trim().max(200).default(""),
  fields: ReceiptFieldsSchema.default({ court: true, shuttle: true, expense: true, discount: true }),
  bank: ReceiptBankSchema.default({ name: "", account_no: "", account_name: "" }),
  payment_show: ReceiptPaymentShowSchema.default({ promptpay: true, bank: false }),
  theme: ReceiptThemeSchema.default("green"),
  bank_qr: z.boolean().default(false),
});
export type ReceiptTemplate = z.infer<typeof ReceiptTemplateSchema>;

export const DEFAULT_RECEIPT_TEMPLATE: ReceiptTemplate = ReceiptTemplateSchema.parse({});

/**
 * Per-field recovery for a nested object: whole-object parse fast path, else keep every
 * sub-field that parses individually and fall back ONLY the corrupt ones. Non-object →
 * wholesale fallback. Mirrors `recoverObjectField` in `tournament/settings.ts`.
 */
function recoverObject<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const whole = schema.safeParse(value);
  if (whole.success) return whole.data;
  if (value == null || typeof value !== "object" || Array.isArray(value)) return fallback;

  const shape = (schema as unknown as { shape?: Record<string, z.ZodType> }).shape;
  if (!shape) return fallback;
  const src = value as Record<string, unknown>;
  const recovered: Record<string, unknown> = { ...(fallback as Record<string, unknown>) };
  for (const key of Object.keys(shape)) {
    const sub = shape[key].safeParse(src[key]);
    if (sub.success) recovered[key] = sub.data;
  }
  const reparsed = schema.safeParse(recovered);
  return reparsed.success ? reparsed.data : fallback;
}

/**
 * Tolerant read-time parse of the raw jsonb column. Whole-object fast path; on partial
 * corruption (manual DB edit / older partial write) preserves every field that parses
 * and falls back the rest, so one bad value never wipes the whole template. The write
 * path keeps strict whole-object validation (see `updateClubReceiptTemplateAction`).
 */
export function parseReceiptTemplate(raw: unknown): ReceiptTemplate {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return structuredClone(DEFAULT_RECEIPT_TEMPLATE);
  }
  const fast = ReceiptTemplateSchema.safeParse(raw);
  if (fast.success) return fast.data;

  const src = raw as Record<string, unknown>;
  const out = structuredClone(DEFAULT_RECEIPT_TEMPLATE);
  if ("footer_note" in src) {
    const p = ReceiptTemplateSchema.shape.footer_note.safeParse(src.footer_note);
    if (p.success) out.footer_note = p.data;
  }
  out.fields = recoverObject(ReceiptFieldsSchema, src.fields, DEFAULT_RECEIPT_TEMPLATE.fields);
  out.bank = recoverObject(ReceiptBankSchema, src.bank, DEFAULT_RECEIPT_TEMPLATE.bank);
  out.payment_show = recoverObject(
    ReceiptPaymentShowSchema,
    src.payment_show,
    DEFAULT_RECEIPT_TEMPLATE.payment_show,
  );
  if ("theme" in src) {
    const p = ReceiptThemeSchema.safeParse(src.theme);
    if (p.success) out.theme = p.data;
  }
  if ("bank_qr" in src) {
    const p = z.boolean().safeParse(src.bank_qr);
    if (p.success) out.bank_qr = p.data;
  }
  return out;
}

/** True when the owner configured a usable bank receiver (#12a). */
export function hasBankReceiver(bank: ReceiptBank): boolean {
  return bank.account_no.trim().length > 0 && bank.name.trim().length > 0;
}

// ─── Theme palette (v2 UI; colors chosen for white-text contrast on the header band) ──

export type ReceiptTheme = { headerBg: string; totalColor: string; accent: string };

export const RECEIPT_THEMES: Record<ReceiptThemeKey, ReceiptTheme> = {
  green: { headerBg: "#2e7d4f", totalColor: "#2e7d4f", accent: "#2e7d4f" }, // current default
  blue: { headerBg: "#1d4ed8", totalColor: "#1d4ed8", accent: "#1d4ed8" },
  rose: { headerBg: "#be123c", totalColor: "#be123c", accent: "#be123c" },
  slate: { headerBg: "#334155", totalColor: "#334155", accent: "#334155" },
  amber: { headerBg: "#b45309", totalColor: "#b45309", accent: "#b45309" },
  violet: { headerBg: "#6d28d9", totalColor: "#6d28d9", accent: "#6d28d9" },
};

export function resolveReceiptTheme(key: string | null | undefined): ReceiptTheme {
  if (key && key in RECEIPT_THEMES) return RECEIPT_THEMES[key as ReceiptThemeKey];
  return RECEIPT_THEMES.green;
}
