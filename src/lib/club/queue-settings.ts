import { z } from "zod";

/**
 * Club rotation-queue config. Stored on `clubs.queue_settings jsonb` so new fields
 * can ship without a migration (mirrors tournaments.settings + parseSettings).
 *
 *  court_count          [frozen] legacy fallback only — superseded by the named-
 *                       courts list `clubs.courts text[]`. No UI writes this field
 *                       anymore; page.tsx still reads it to backfill ['1'..'N'] when
 *                       clubs.courts is empty. Kept in the schema so old rows parse.
 *  players_per_team     1 = เดี่ยว, 2 = คู่
 *  rotation_mode        fair_queue   = ทุกคนหมุนตามคิว
 *                       winner_stays = ผู้ชนะอยู่ต่อ (เปลี่ยนเฉพาะฝั่งแพ้)
 *                       fair_winner_fallback = หมุนเวียนทั่วถึง (ทุกคนสลับลง) แต่ถ้า
 *                       คนพักไม่พอตั้งแมตช์ใหม่ → ผู้ชนะอยู่ต่อ (winner_stays_max ไม่มีผล)
 *  queue_mode           rest_longest = คนพักนานสุดก่อน (default, แนะนำ)
 *                       level_match  = คนพักนานสุดก่อน + แบ่งฝั่งให้ระดับสมดุล (เปิด skill_level อัตโนมัติ)
 *                       (legacy "smart" → level_match, "fifo" → rest_longest — parseQueueSettings แปลงให้อัตโนมัติ)
 *  skill_level_enabled  ผูกกับ queue_mode: จะ true ก็ต่อเมื่อเลือก level_match — UI ตั้งให้อัตโนมัติ ไม่มี
 *                       toggle แยก. คุมทั้งการเลือกผู้เล่นตามระดับ (level_match) + การแบ่งฝั่งให้บาลานซ์ระดับ
 *  game_time_limit_min  จำกัดเวลา/เกม (0 = ไม่จำกัด) — UI hint สำหรับ referee
 *  winner_stays_max     winner_stays: ชนะติดกันได้กี่เกมก่อนบังคับพัก (0 = ไม่จำกัด)
 *  max_skill_gap        ระยะห่างระดับสูงสุดที่ยอมรับระหว่างผู้เล่นในแมตช์เดียวกัน
 *                       (0 = ไม่จำกัด — พฤติกรรมเดิม); ใช้กับ level_match
 *  balance_strictness   balanced = ผ่อนเพดาน gap เมื่อคนไม่พอ (default)
 *                       strict   = ปฏิเสธแมตช์ถ้าหา candidate ในเพดานไม่พอ
 *                       (legacy "loose" = balanced — parseQueueSettings แปลงให้อัตโนมัติ)
 *  balance_locked_pairs true = เช็ก gap ระหว่าง mean level ของฝั่งล็อกกับฝ่ายตรงข้าม
 *                       (strict + max_skill_gap > 0 เท่านั้น — default false)
 *  realtime_enabled     true = หน้าก๊วน subscribe Realtime broadcast (topic `club:<id>`)
 *                       → คิว/ผู้เล่นอัปเดตสดข้ามอุปกรณ์โดยไม่ต้องรีเฟรช (default true,
 *                       mirror tournaments.settings.realtime_enabled). ปิด = manual refresh
 */
export const ClubQueueSettingsSchema = z.object({
  court_count: z.number().int().min(1).max(20).default(1),
  players_per_team: z.union([z.literal(1), z.literal(2)]).default(2),
  rotation_mode: z.enum(["fair_queue", "winner_stays", "fair_winner_fallback"]).default("fair_queue"),
  queue_mode: z.enum(["rest_longest", "level_match"]).default("rest_longest"),
  skill_level_enabled: z.boolean().default(false),
  game_time_limit_min: z.number().int().min(0).max(120).default(0),
  winner_stays_max: z.number().int().min(0).max(20).default(2),
  max_skill_gap: z.number().min(0).max(20).default(0),
  balance_strictness: z.enum(["balanced", "strict"]).default("balanced"),
  balance_locked_pairs: z.boolean().default(false),
  realtime_enabled: z.boolean().default(true),
});

export type ClubQueueSettings = z.infer<typeof ClubQueueSettingsSchema>;

export const DEFAULT_QUEUE_SETTINGS: ClubQueueSettings = ClubQueueSettingsSchema.parse({});

/**
 * Fold removed legacy enum values onto their surviving twin, in place, before any
 * schema parse. `queue_mode "smart"` ≡ `"level_match"` (identical ordering +
 * level split); `queue_mode "fifo"` → `"rest_longest"` (fifo removed — both are
 * pure queue-order modes, rest_longest just orders by rest instead of intake);
 * `balance_strictness "loose"` ≡ `"balanced"` (only "strict" ever branched).
 * Keeps existing clubs working with no DB migration.
 */
export function normalizeLegacyQueueValues(
  rec: Record<string, unknown>,
): Record<string, unknown> {
  if (rec.queue_mode === "smart") rec.queue_mode = "level_match";
  if (rec.queue_mode === "fifo") rec.queue_mode = "rest_longest";
  if (rec.balance_strictness === "loose") rec.balance_strictness = "balanced";
  return rec;
}

/**
 * Per-field fallback parse: if the whole-object parse passes, return it; otherwise
 * keep any field that parses individually instead of dropping everything. Defends
 * against partial corruption from manual DB edits / older partial writes.
 */
/**
 * Field-by-field equality for the Save/Discard dirty check in
 * ClubQueueSettings. Deliberately not `JSON.stringify(a) === JSON.stringify(b)`
 * — key order isn't guaranteed to match between the seeded `initial` prop and
 * a draft rebuilt via object spread, so string comparison could report a
 * false positive "dirty" even when every field is equal.
 */
export function queueSettingsEqual(
  a: ClubQueueSettings,
  b: ClubQueueSettings,
): boolean {
  const keys = Object.keys(ClubQueueSettingsSchema.shape) as Array<
    keyof ClubQueueSettings
  >;
  return keys.every((key) => a[key] === b[key]);
}

export function parseQueueSettings(raw: unknown): ClubQueueSettings {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_QUEUE_SETTINGS;
  }

  const rec = normalizeLegacyQueueValues({ ...(raw as Record<string, unknown>) });
  // Whether the stored config carried an explicit skill_level_enabled. Since
  // v0.25.0 the flag has no standalone control — it is implied by the queue mode
  // (on iff level_match). Configs written before the coupling, or by any older
  // write path that omitted the flag, must have it DERIVED so a level_match
  // config actually uses levels and a non-level_match one doesn't. An
  // explicitly-stored value is preserved so legacy rows keep their behavior
  // until re-saved through the settings card.
  const hasSkillFlag = "skill_level_enabled" in rec;
  const withCoupling = (s: ClubQueueSettings): ClubQueueSettings =>
    hasSkillFlag
      ? s
      : { ...s, skill_level_enabled: s.queue_mode === "level_match" };

  const fast = ClubQueueSettingsSchema.safeParse(rec);
  if (fast.success) return withCoupling(fast.data);

  const out: ClubQueueSettings = { ...DEFAULT_QUEUE_SETTINGS };
  const shape = ClubQueueSettingsSchema.shape;
  for (const key of Object.keys(shape) as Array<keyof typeof shape>) {
    if (!(key in rec)) continue;
    const parsed = shape[key].safeParse(rec[key]);
    if (parsed.success) {
      (out as Record<string, unknown>)[key] = parsed.data;
    }
  }
  return withCoupling(out);
}
