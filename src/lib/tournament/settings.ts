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
  // Division ordering for auto-rotate / queue sort (N-division):
  //   sequential   = process divisions in priority order (all of div 1, then div 2, …)
  //   interleaved  = literal round-robin zip across divisions
  //   chunked      = chunks of queue_chunk_size per division, rotating priority order
  queue_division_order: z.enum(["sequential", "interleaved", "chunked"]).default("interleaved"),
  // Explicit priority order for divisions (1-based div numbers); [] = natural order (1, 2, …N)
  queue_division_priority: z.array(z.number().int().min(1).max(20)).default([]),
  queue_chunk_size: z.number().int().min(1).max(50).default(10),
  court_strict: z.boolean().default(true),
  color_summary: z.boolean().default(true),
  export_visible: z.boolean().default(true),
  allow_force_bracket_reset: z.boolean().default(false),
  allow_manual_match_after_bracket: z.boolean().default(true),
  auto_advance_next: z.boolean().default(false),
  require_court_to_start: z.boolean().default(false),
  realtime_enabled: z.boolean().default(true),
  audit_log_enabled: z.boolean().default(true),
  match_cooldown_minutes: z.number().int().min(0).max(30).default(0),

  // TV display
  tv_show_team_chart: z.boolean().default(true),
  tv_show_standings_carousel: z.boolean().default(true),
  tv_show_upcoming: z.boolean().default(true),
  tv_show_completed: z.boolean().default(true),
  tv_show_fullscreen_button: z.boolean().default(true),
  tv_show_bracket_link: z.boolean().default(true),

  tv_upcoming_count: z.number().int().min(1).max(5).default(3),
  tv_completed_count: z.number().int().min(1).max(3).default(1),
  tv_standings_rows: z.number().int().min(0).max(50).default(6),

  tv_carousel_interval_sec: z.number().int().min(3).max(30).default(8),
  tv_refresh_interval_sec: z.number().int().min(30).max(300).default(60),

  // Chart bar orientation for Dashboard bar charts (recharts):
  //   vertical   = category on X axis, value on Y axis (vertical bars, default)
  //   horizontal = category on Y axis, value on X axis (horizontal bars)
  chart_orientation: z.enum(["vertical", "horizontal"]).default("vertical"),
});

export type TournamentSettings = z.infer<typeof TournamentSettingsSchema>;
export type LineNotifyFlags = z.infer<typeof LineNotifyFlagsSchema>;

export const DEFAULT_SETTINGS: TournamentSettings = TournamentSettingsSchema.parse({});

// Legacy translator: maps old queue_bracket_preference values to the new N-division fields.
// Called inside parseSettings before schema-level safeParse so both the fast path and the
// per-field fallback path operate on already-normalised data.
type LegacyPreference =
  | "upper_first"
  | "lower_first"
  | "interleaved"
  | "chunk_upper_first"
  | "chunk_lower_first";

const LEGACY_PREFERENCE_MAP: Record<
  LegacyPreference,
  Pick<TournamentSettings, "queue_division_order" | "queue_division_priority">
> = {
  upper_first:       { queue_division_order: "sequential",  queue_division_priority: [1, 2] },
  lower_first:       { queue_division_order: "sequential",  queue_division_priority: [2, 1] },
  interleaved:       { queue_division_order: "interleaved", queue_division_priority: [] },
  chunk_upper_first: { queue_division_order: "chunked",     queue_division_priority: [1, 2] },
  chunk_lower_first: { queue_division_order: "chunked",     queue_division_priority: [2, 1] },
};

function normalizeLegacy(raw: Record<string, unknown>): Record<string, unknown> {
  const pref = raw["queue_bracket_preference"] as string | undefined;
  if (pref && !("queue_division_order" in raw)) {
    const mapped = LEGACY_PREFERENCE_MAP[pref as LegacyPreference];
    if (mapped) {
      const { queue_bracket_preference: _dropped, ...rest } = raw;
      void _dropped;
      return { ...rest, ...mapped };
    }
    // Unknown legacy value: just drop the key and let defaults apply
    const { queue_bracket_preference: _dropped, ...rest } = raw;
    void _dropped;
    return rest;
  }
  // queue_division_order already present OR no legacy key — strip legacy key if still present
  if ("queue_bracket_preference" in raw) {
    const { queue_bracket_preference: _dropped, ...rest } = raw;
    void _dropped;
    return rest;
  }
  return raw;
}

// Per-field fallback: if the whole-object parse passes, return it; otherwise
// preserve any field that parses individually instead of dropping everything.
// Defends against partial corruption from manual DB edits.
export function parseSettings(raw: unknown): TournamentSettings {
  if (raw == null || typeof raw !== "object") return DEFAULT_SETTINGS;

  // Normalise legacy queue_bracket_preference before any parsing
  const normalised = normalizeLegacy(raw as Record<string, unknown>);

  const fast = TournamentSettingsSchema.safeParse(normalised);
  if (fast.success) return fast.data;

  const out: TournamentSettings = { ...DEFAULT_SETTINGS };
  const shape = TournamentSettingsSchema.shape;
  for (const key of Object.keys(shape) as Array<keyof typeof shape>) {
    if (!(key in normalised)) continue;
    const fieldSchema = shape[key];
    const parsed = fieldSchema.safeParse(normalised[key]);
    if (parsed.success) {
      (out as Record<string, unknown>)[key] = parsed.data;
    }
  }
  return out;
}
