import { z } from "zod";

/**
 * Club rotation-queue config. Stored on `clubs.queue_settings jsonb` so new fields
 * can ship without a migration (mirrors tournaments.settings + parseSettings).
 *
 *  court_count          จำนวนสนามที่เปิด
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
