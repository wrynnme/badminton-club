import { z } from "zod";

export const LineNotifyFlagsSchema = z.object({
  start: z.boolean().default(true),
  score: z.boolean().default(true),
  bracket: z.boolean().default(true),
  status: z.boolean().default(true),
});

export const TournamentSettingsSchema = z.object({
  line_notify: LineNotifyFlagsSchema.default({
    start: true,
    score: true,
    bracket: true,
    status: true,
  }),
  auto_rotate_rest_gap: z.number().int().min(0).max(5).default(2),
  court_strict: z.boolean().default(true),
  color_summary: z.boolean().default(true),
  export_visible: z.boolean().default(true),
  allow_force_bracket_reset: z.boolean().default(false),
  allow_manual_match_after_bracket: z.boolean().default(true),
  auto_advance_next: z.boolean().default(false),
  realtime_enabled: z.boolean().default(true),
  audit_log_enabled: z.boolean().default(true),
  match_cooldown_minutes: z.number().int().min(0).max(30).default(0),
});

export type TournamentSettings = z.infer<typeof TournamentSettingsSchema>;
export type LineNotifyFlags = z.infer<typeof LineNotifyFlagsSchema>;

export const DEFAULT_SETTINGS: TournamentSettings = TournamentSettingsSchema.parse({});

// Per-field fallback: if the whole-object parse passes, return it; otherwise
// preserve any field that parses individually instead of dropping everything.
// Defends against partial corruption from manual DB edits.
export function parseSettings(raw: unknown): TournamentSettings {
  if (raw == null || typeof raw !== "object") return DEFAULT_SETTINGS;
  const fast = TournamentSettingsSchema.safeParse(raw);
  if (fast.success) return fast.data;

  const out: TournamentSettings = { ...DEFAULT_SETTINGS };
  const obj = raw as Record<string, unknown>;
  const shape = TournamentSettingsSchema.shape;
  for (const key of Object.keys(shape) as Array<keyof typeof shape>) {
    if (!(key in obj)) continue;
    const fieldSchema = shape[key];
    const parsed = fieldSchema.safeParse(obj[key]);
    if (parsed.success) {
      (out as Record<string, unknown>)[key] = parsed.data;
    }
  }
  return out;
}
