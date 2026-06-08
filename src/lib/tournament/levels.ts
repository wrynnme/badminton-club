// Shared level helpers for the tournament side. `team_players.level_id` → `levels`
// (the same skill-level table the club uses); `pairs.pair_level` is the numeric
// SUM of the two players' `levels.real`, stored as TEXT so `divisions.ts`
// (`parsePairLevel` → parseFloat) keeps working unchanged.

/**
 * Coerce a Supabase `levels.real` value to a finite number or null.
 * `real` is numeric in Postgres but arrives as a STRING in JSON embeds
 * (e.g. `{ real: "3" }`), so a plain `Number()` is required.
 */
export function realOf(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sum two players' `levels.real` into a `pair_level` string (matching the legacy
 * text storage). Returns null only when BOTH reals are absent — a pair with one
 * rated player keeps that player's value (mirrors the old free-text behaviour).
 */
export function pairLevelString(
  realA: number | null | undefined,
  realB: number | null | undefined,
): string | null {
  const a = realA != null && Number.isFinite(realA) ? realA : null;
  const b = realB != null && Number.isFinite(realB) ? realB : null;
  if (a == null && b == null) return null;
  return String((a ?? 0) + (b ?? 0));
}

/** Pull `real` out of a Supabase FK embed that may be an object or a 1-element array. */
export function embeddedReal(levels: unknown): number | null {
  const row = Array.isArray(levels) ? levels[0] : levels;
  return realOf((row as { real?: unknown } | null)?.real);
}
