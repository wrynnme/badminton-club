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
  // T2 — team-mode group_knockout only: when ON, empty knockout-bracket slots are
  // filled with the best non-advancing teams ranked cross-group (e.g. best 3rd-placers)
  // instead of being left as first-round BYEs. Opt-in: a BYE that rewards group winners
  // is a legitimate format. No effect in pair mode (division-wide seeding) or when an
  // independent lower bracket already consumes the next-rank teams.
  knockout_fill_byes: z.boolean().default(false),
  auto_advance_next: z.boolean().default(false),
  require_court_to_start: z.boolean().default(false),
  require_checkin: z.boolean().default(false),
  realtime_enabled: z.boolean().default(true),
  // T5 — granular queue realtime (opt-in, default off). When ON, the match queue
  // patches individual match rows from postgres_changes UPDATE payloads (no full
  // page refetch) for snappier multi-court updates. INSERT/DELETE still fall back
  // to router.refresh, and the page-level debounced refresh stays as the authority,
  // so this is purely additive — it cannot regress the working refresh path.
  queue_payload_sync: z.boolean().default(false),
  audit_log_enabled: z.boolean().default(true),
  match_cooldown_minutes: z.number().int().min(0).max(30).default(0),
  // Default best-of format for matches. Competition-mode classes override per-class
  // via tournament_classes.match_format. fixed_2 = 2 games (1-1 draw allowed);
  // best_of_3 = first to 2; best_of_5 = first to 3. See match-format.ts.
  default_match_format: z.enum(["fixed_2", "best_of_3", "best_of_5"]).default("best_of_3"),

  // TV display
  tv_show_team_chart: z.boolean().default(true),
  tv_show_standings_carousel: z.boolean().default(true),
  tv_show_upcoming: z.boolean().default(true),
  tv_show_completed: z.boolean().default(true),
  tv_show_fullscreen_button: z.boolean().default(true),
  tv_show_bracket_link: z.boolean().default(true),

  tv_completed_count: z.number().int().min(1).max(3).default(1),
  tv_standings_rows: z.number().int().min(0).max(50).default(6),

  tv_carousel_interval_sec: z.number().int().min(3).max(30).default(8),
  tv_upcoming_interval_sec: z.number().int().min(3).max(30).default(8),
  tv_refresh_interval_sec: z.number().int().min(30).max(300).default(60),
  tv_standings_font_size: z.enum(["sm", "md", "lg", "xl"]).default("md"),

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
  // Defensive: caller's TypeScript guards `typeof === "object"` but that
  // includes arrays. Return arrays unchanged so the downstream zod parse
  // rejects them naturally instead of crashing on object-spread semantics.
  if (Array.isArray(raw)) return raw;
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

// Recover a nested-object field sub-value-by-sub-value. If the whole object parses,
// return it. Otherwise (one corrupt sub-value from a manual DB edit) keep every
// sub-field that parses individually, falling back ONLY the corrupt sub-field to its
// default — so one bad flag never wipes its valid siblings. Non-object inputs fall
// back wholesale. Read-time only: the write path keeps strict whole-object validation
// (a `.catch()` on the schema would silently coerce garbage on write — we don't want that).
function recoverObjectField(
  objSchema: typeof LineNotifyFlagsSchema,
  value: unknown,
  fallback: LineNotifyFlags,
): LineNotifyFlags {
  const whole = objSchema.safeParse(value);
  if (whole.success) return whole.data;
  if (value == null || typeof value !== "object" || Array.isArray(value)) return fallback;

  const src = value as Record<string, unknown>;
  const subShape = objSchema.shape as Record<string, z.ZodType>;
  const recovered: Record<string, unknown> = { ...fallback };
  for (const subKey of Object.keys(subShape)) {
    const sub = subShape[subKey].safeParse(src[subKey]);
    if (sub.success) recovered[subKey] = sub.data;
  }
  const reparsed = objSchema.safeParse(recovered);
  return reparsed.success ? reparsed.data : fallback;
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
    // line_notify is the only nested object — recover its flags sub-field-wise so a
    // single corrupt flag doesn't reset the whole group. (Add other nested objects here
    // if the schema grows them.) Everything else is scalar/enum/array → whole-value parse.
    if (key === "line_notify") {
      out.line_notify = recoverObjectField(
        LineNotifyFlagsSchema,
        normalised[key],
        DEFAULT_SETTINGS.line_notify,
      );
      continue;
    }
    const parsed = shape[key].safeParse(normalised[key]);
    if (parsed.success) {
      (out as Record<string, unknown>)[key] = parsed.data;
    }
  }
  return out;
}
