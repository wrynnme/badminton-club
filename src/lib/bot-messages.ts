/**
 * bot-messages.ts — site-admin-editable templates for the bot's automated LINE
 * messages (wayfinder #59 / #60).
 *
 * Every user-facing string the bot emits used to be a hardcoded literal in
 * `route.ts` / `line.ts` / `matches.ts` / `group-billing.ts`. This module is the
 * single registry of those templates: their built-in defaults, the placeholders
 * each one may interpolate, and which of those placeholders are REQUIRED (so the
 * /admin editor can reject a save that drops a `{club}` and would ship a message
 * missing its context).
 *
 * Storage: overrides live in `app_settings.messages jsonb` (site-admin, global).
 * A missing / blank / unparseable override falls back to the code default, so the
 * bot can never go silent — see `resolveBotMessage`.
 *
 * Placeholder syntax is `{name}`. `renderBotMessage` substitutes known names and
 * STRIPS any unknown `{...}` (a typo can't leak a raw brace into a live message).
 *
 * NOTE (scope, v1): messages whose formatting is conditional — the group-bill
 * header's optional ` · {date}` and the match-call's optional ` (สนาม {court})` —
 * are NOT templated here; their surrounding structure stays code-controlled and
 * only the pure-substitution bodies are editable. The scan prompt (no braces) is
 * editable; the header is a follow-up.
 */

export type BotMessageKey =
  | "bindSuccess"
  | "bindInvalid"
  | "bindConflict"
  | "selfLinkUsage"
  | "selfLinkNoUser"
  | "selfLinkNoClub"
  | "selfLinkProfileFailed"
  | "selfLinkLinked"
  | "selfLinkAlready"
  | "selfLinkPooled"
  | "notifyStatus"
  | "notifyBracket"
  | "notifyScore"
  | "notifyMatchCall"
  | "groupBillScanPrompt";

type BotMessageSpec = {
  /** Placeholders this template may use; those that are REQUIRED must appear in any override. */
  readonly required: readonly string[];
  /** Built-in Thai default (LINE bodies stay Thai by project convention). */
  readonly default: string;
};

/**
 * The registry. `required` lists placeholders that MUST survive an edit — dropping
 * one would ship a message missing runtime context (e.g. bindSuccess without the
 * club name). Messages with `required: []` are free text.
 */
export const BOT_MESSAGE_SPECS: Record<BotMessageKey, BotMessageSpec> = {
  bindSuccess: {
    required: ["club"],
    default: `✅ ผูกกลุ่มนี้กับก๊วน "{club}" แล้ว — ต่อไปเรียกเก็บเงินในกลุ่มนี้ได้เลย`,
  },
  bindInvalid: {
    required: [],
    default: `❌ โค้ดผูกก๊วนไม่ถูกต้อง`,
  },
  bindConflict: {
    required: [],
    default: `❌ ผูกกลุ่มไม่สำเร็จ — กลุ่มนี้อาจถูกผูกกับก๊วนอื่นอยู่แล้ว`,
  },
  selfLinkUsage: {
    required: [],
    default: `พิมพ์แบบนี้นะ: แท็กบอทแล้วต่อด้วย  เชื่อมไลน์ <ชื่อในโพย>  เช่น  เชื่อมไลน์ โจ้`,
  },
  selfLinkNoUser: {
    required: [],
    default: `❌ ระบุตัวตนไม่ได้ ลองใหม่ในแอป LINE บนมือถือ หรือใช้ลิงก์เชิญจากผู้ดูแลก๊วน`,
  },
  selfLinkNoClub: {
    required: [],
    default: `❌ กลุ่มนี้ยังไม่ได้ผูกก๊วน — ให้ผู้ดูแลพิมพ์  ผูกก๊วน <โค้ด>  ก่อน`,
  },
  selfLinkProfileFailed: {
    required: [],
    default: `❌ ดึงโปรไฟล์ไม่สำเร็จ ลองใหม่อีกครั้งนะ`,
  },
  selfLinkLinked: {
    required: ["player"],
    default: `✅ เชื่อม LINE กับ "{player}" ในก๊วนเรียบร้อย — จากนี้จะได้รับบิลและแจ้งเตือนทาง LINE`,
  },
  selfLinkAlready: {
    required: ["player"],
    default: `ℹ️ คุณเชื่อมกับ "{player}" ในก๊วนนี้อยู่แล้ว`,
  },
  selfLinkPooled: {
    required: [],
    default: `📝 รับคำขอแล้ว — ไม่พบชื่อที่ตรงพอดี ผู้ดูแลก๊วนจะจับคู่ให้เอง`,
  },
  notifyStatus: {
    required: ["status"],
    default: `สถานะเปลี่ยนเป็น: {status}`,
  },
  notifyBracket: {
    required: [],
    default: `สร้างสายน็อคเอ้าแล้ว`,
  },
  notifyScore: {
    required: ["a", "b", "scoreA", "scoreB", "detail", "winner"],
    default: `🏸 {a} vs {b}\nเกมที่ชนะ: {scoreA}:{scoreB} ({detail})\nผู้ชนะ: {winner}`,
  },
  notifyMatchCall: {
    // `{court}` is OPTIONAL — the caller passes a pre-formatted " (สนาม X)" (or ""
    // when no court). Its parentheses/spacing stay code-controlled; only its
    // position in the line is template-editable.
    required: ["num", "a", "b"],
    default: `🏸 เรียกแมตช์ #{num}{court}\n{a} vs {b}`,
  },
  groupBillScanPrompt: {
    required: [],
    default: `สแกน QR ด้านล่างจ่ายได้เลย 🙏`,
  },
};

export const BOT_MESSAGE_KEYS = Object.keys(BOT_MESSAGE_SPECS) as BotMessageKey[];

/**
 * Example values for the /admin live preview — plausible placeholder fills so the
 * editor can render each template the way a real send would look. Preview-only.
 */
export const BOT_MESSAGE_SAMPLE_VARS: Record<BotMessageKey, Vars> = {
  bindSuccess: { club: "ก๊วนสุขสันต์" },
  bindInvalid: {},
  bindConflict: {},
  selfLinkUsage: {},
  selfLinkNoUser: {},
  selfLinkNoClub: {},
  selfLinkProfileFailed: {},
  selfLinkLinked: { player: "โจ้" },
  selfLinkAlready: { player: "โจ้" },
  selfLinkPooled: {},
  notifyStatus: { status: "กำลังแข่งขัน" },
  notifyBracket: {},
  notifyScore: {
    a: "ทีมแดง",
    b: "ทีมน้ำเงิน",
    scoreA: 2,
    scoreB: 1,
    detail: "21-15, 18-21, 21-19",
    winner: "ทีมแดง",
  },
  notifyMatchCall: { num: 5, a: "ทีมแดง", b: "ทีมน้ำเงิน", court: " (สนาม 3)" },
  groupBillScanPrompt: {},
};

/** Just the built-in defaults, keyed. */
export const DEFAULT_BOT_MESSAGES: Record<BotMessageKey, string> = Object.fromEntries(
  BOT_MESSAGE_KEYS.map((k) => [k, BOT_MESSAGE_SPECS[k].default]),
) as Record<BotMessageKey, string>;

export type Vars = Record<string, string | number>;

const PLACEHOLDER_RE = /\{(\w+)\}/g;

/**
 * Substitute `{name}` placeholders from `vars`; any unknown `{...}` is stripped
 * (removed entirely) so a stray/typo brace can never appear in a sent message.
 */
export function renderBotMessage(template: string, vars: Vars = {}): string {
  return template.replace(PLACEHOLDER_RE, (_m, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : "",
  );
}

/**
 * Placeholders required by `key` that are MISSING from `text`. Empty array = ok.
 * Used by the save action to reject an override that dropped a required variable.
 */
export function missingRequiredPlaceholders(key: BotMessageKey, text: string): string[] {
  const present = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  while ((m = re.exec(text)) !== null) present.add(m[1]);
  return BOT_MESSAGE_SPECS[key].required.filter((v) => !present.has(v));
}

/**
 * Tolerant parse of the raw `app_settings.messages` jsonb into a clean override
 * map. Keeps only known keys whose value is a non-empty (after trim) string — an
 * unknown key, non-string, or blank value is dropped so it falls back to default.
 * Never throws (mirrors receipt.ts recover-parse).
 */
export function parseBotMessages(raw: unknown): Partial<Record<BotMessageKey, string>> {
  const out: Partial<Record<BotMessageKey, string>> = {};
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const key of BOT_MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim().length > 0) out[key] = v;
  }
  return out;
}

/**
 * Resolve the template for `key` (override if present + non-blank, else default)
 * and render it with `vars`. The single call site every bot message goes through.
 */
export function resolveBotMessage(
  overrides: Partial<Record<BotMessageKey, string>> | null | undefined,
  key: BotMessageKey,
  vars: Vars = {},
): string {
  const override = overrides?.[key];
  const template = override && override.trim().length > 0 ? override : DEFAULT_BOT_MESSAGES[key];
  return renderBotMessage(template, vars);
}
