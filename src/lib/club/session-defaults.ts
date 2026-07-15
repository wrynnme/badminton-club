import { z } from "zod";
import type { Club } from "@/lib/types";
import {
  ClubQueueSettingsSchema,
  DEFAULT_QUEUE_SETTINGS,
  parseQueueSettings,
} from "@/lib/club/queue-settings";

/**
 * session-defaults.ts — zod schema + tolerant parser for `club_series.session_defaults`
 * (ADR 0002 decision #15 — "the living successor of the retired preset system").
 *
 * Canonical shape seeded by the backfill migration
 * (`20260715000300_club_series_backfill.sql`, jsonb_build_object) and by
 * `ensureSeriesForClub`'s lazy-create path (`buildSessionDefaultsFromClub` below,
 * moved out of `series.server.ts` so this module has no server-only dependency):
 *
 *   { venue, start_time, end_time, max_players, court_fee, shuttle_price,
 *     court_split, shuttle_split, courts, queue_settings }
 *
 * Every field except `courts`/`queue_settings` is nullable — null means "no
 * explicit default set yet", resolved to a hardcoded fallback (SESSION_FALLBACKS)
 * only at open-session time (`buildSessionInsert` in `open-session.ts`). This
 * mirrors `parseQueueSettings`'s per-field-fallback style: a corrupted/partial
 * jsonb value degrades field-by-field instead of throwing or wiping the object.
 */
export const SessionDefaultsSchema = z.object({
  venue: z.string().nullable().default(null),
  // "HH:MM:SS" (Postgres `time` cast to text, e.g. the backfill) or "HH:MM"
  // (form input) — both are stored/read as opaque strings, never parsed as a Date.
  start_time: z.string().nullable().default(null),
  end_time: z.string().nullable().default(null),
  max_players: z.number().int().min(2).max(40).nullable().default(null),
  court_fee: z.number().min(0).nullable().default(null),
  shuttle_price: z.number().min(0).nullable().default(null),
  court_split: z.enum(["even", "by_time"]).nullable().default(null),
  shuttle_split: z.enum(["even", "per_match", "per_player", "by_time"]).nullable().default(null),
  courts: z.array(z.string()).default([]),
  queue_settings: ClubQueueSettingsSchema.default(DEFAULT_QUEUE_SETTINGS),
});

export type SessionDefaults = z.infer<typeof SessionDefaultsSchema>;

export const DEFAULT_SESSION_DEFAULTS: SessionDefaults = SessionDefaultsSchema.parse({});

/**
 * Hardcoded fallbacks used only when OPENING a session and the series has no
 * explicit default for that field yet (null) — same values
 * `applyClubPresetAction` used for a brand-new club from a preset. Fees/splits/
 * courts fall back to 0/"even"/[] inline in `buildSessionInsert` instead of
 * living here, since those are the schema's own natural empty values.
 */
export const SESSION_FALLBACKS = {
  venue: "ก๊วน",
  start_time: "18:00",
  end_time: "21:00",
  max_players: 12,
} as const;

/**
 * Per-field fallback parse: if the whole-object parse passes, return it;
 * otherwise keep any field that parses individually instead of dropping
 * everything (mirrors `parseQueueSettings` / `parsePresetConfig`). Never throws.
 */
export function parseSessionDefaults(raw: unknown): SessionDefaults {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_SESSION_DEFAULTS;
  }

  const rec = { ...(raw as Record<string, unknown>) };
  // Normalize the queue block through parseQueueSettings BEFORE the schema parse
  // (itself tolerant + derives skill_level_enabled) so it never fails the
  // whole-object fast path on a legacy/partial queue_settings value.
  rec.queue_settings = parseQueueSettings(rec.queue_settings);

  const fast = SessionDefaultsSchema.safeParse(rec);
  if (fast.success) return fast.data;

  const out: SessionDefaults = { ...DEFAULT_SESSION_DEFAULTS };
  const shape = SessionDefaultsSchema.shape;
  for (const key of Object.keys(shape) as Array<keyof typeof shape>) {
    if (!(key in rec)) continue;
    if (key === "queue_settings") {
      out.queue_settings = parseQueueSettings(rec.queue_settings);
      continue;
    }
    const parsed = shape[key].safeParse(rec[key]);
    if (parsed.success) {
      (out as Record<string, unknown>)[key] = parsed.data;
    }
  }
  return out;
}

/**
 * session_defaults shape (decision #15) — must match the backfill migration's
 * jsonb_build_object exactly. Moved here from `series.server.ts` (P2) so it can
 * be shared by the create-series action without pulling in server-only Supabase
 * imports transitively.
 */
export function buildSessionDefaultsFromClub(club: Club): Record<string, unknown> {
  return {
    venue: club.venue,
    start_time: club.start_time,
    end_time: club.end_time,
    max_players: club.max_players,
    court_fee: club.court_fee,
    shuttle_price: club.shuttle_price,
    court_split: club.court_split,
    shuttle_split: club.shuttle_split,
    courts: club.courts,
    queue_settings: club.queue_settings,
  };
}
