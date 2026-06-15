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
 *  queue_mode           rest_longest = คนพักนานสุดก่อน (default, แนะนำ)
 *                       fifo         = เข้าก่อนออกก่อน (position/joined_at)
 *                       level_match  = จับคู่ระดับใกล้กัน (ต้อง skill_level_enabled)
 *                       smart        = ถ่วงน้ำหนักหลายปัจจัย (v1 = rest_longest + level tiebreak)
 *  skill_level_enabled  ใช้ระดับฝีมือใน level_match / smart + ตอนลงชื่อ
 *  game_time_limit_min  จำกัดเวลา/เกม (0 = ไม่จำกัด) — UI hint สำหรับ referee
 *  not_ready_action     requeue = ต่อท้ายคิว, skip = ข้าม เมื่อผู้เล่นไม่พร้อม
 *  winner_stays_max     winner_stays: ชนะติดกันได้กี่เกมก่อนบังคับพัก (0 = ไม่จำกัด)
 *  max_skill_gap        ระยะห่างระดับสูงสุดที่ยอมรับระหว่างผู้เล่นในแมตช์เดียวกัน
 *                       (0 = ไม่จำกัด — พฤติกรรมเดิม); ใช้กับ level_match / smart
 *  balance_strictness   loose    = ผ่อนเพดาน gap เมื่อไม่พอคน
 *                       balanced = ผ่อนเพดาน (เหมือน loose; default)
 *                       strict   = ปฏิเสธแมตช์ถ้าหา candidate ในเพดานไม่พอ
 *  balance_locked_pairs true = เช็ก gap ระหว่าง mean level ของฝั่งล็อกกับฝ่ายตรงข้าม
 *                       (strict + max_skill_gap > 0 เท่านั้น — default false)
 *  realtime_enabled     true = หน้าก๊วน subscribe Realtime broadcast (topic `club:<id>`)
 *                       → คิว/ผู้เล่นอัปเดตสดข้ามอุปกรณ์โดยไม่ต้องรีเฟรช (default true,
 *                       mirror tournaments.settings.realtime_enabled). ปิด = manual refresh
 */
export const ClubQueueSettingsSchema = z.object({
  court_count: z.number().int().min(1).max(20).default(1),
  players_per_team: z.union([z.literal(1), z.literal(2)]).default(2),
  rotation_mode: z.enum(["fair_queue", "winner_stays"]).default("fair_queue"),
  queue_mode: z.enum(["rest_longest", "fifo", "level_match", "smart"]).default("rest_longest"),
  skill_level_enabled: z.boolean().default(false),
  game_time_limit_min: z.number().int().min(0).max(120).default(0),
  not_ready_action: z.enum(["requeue", "skip"]).default("requeue"),
  winner_stays_max: z.number().int().min(0).max(20).default(2),
  max_skill_gap: z.number().min(0).max(20).default(0),
  balance_strictness: z.enum(["loose", "balanced", "strict"]).default("balanced"),
  balance_locked_pairs: z.boolean().default(false),
  realtime_enabled: z.boolean().default(true),
});

export type ClubQueueSettings = z.infer<typeof ClubQueueSettingsSchema>;

export const DEFAULT_QUEUE_SETTINGS: ClubQueueSettings = ClubQueueSettingsSchema.parse({});

/**
 * Per-field fallback parse: if the whole-object parse passes, return it; otherwise
 * keep any field that parses individually instead of dropping everything. Defends
 * against partial corruption from manual DB edits / older partial writes.
 */
export function parseQueueSettings(raw: unknown): ClubQueueSettings {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_QUEUE_SETTINGS;
  }

  const fast = ClubQueueSettingsSchema.safeParse(raw);
  if (fast.success) return fast.data;

  const out: ClubQueueSettings = { ...DEFAULT_QUEUE_SETTINGS };
  const shape = ClubQueueSettingsSchema.shape;
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
