// Division numbering convention:
//   Division 1 = HIGHEST skill tier (legacy 'upper' maps to '1' after migration).
//   thresholds[] is sorted ascending.
//   pair_level > thresholds[N-2]          → Division 1   (top tier)
//   thresholds[i-1] < pair_level ≤ thresholds[i] → Division (N-1-i) ... intermediate
//   pair_level ≤ thresholds[0]            → Division N   (bottom tier)
//   Empty thresholds [] → null (single bucket, no division split).

export function divisionCount(thresholds: number[]): number {
  return thresholds.length + 1;
}

export function computePairDivision(
  pairLevel: number | null | undefined,
  thresholds: number[],
): number | null {
  if (thresholds.length === 0) return null;
  const lvl = pairLevel ?? 0;
  const N = thresholds.length + 1;
  // Walk thresholds from highest to lowest; first threshold beaten = division index
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (lvl > thresholds[i]) return N - 1 - i; // top-down: highest threshold → div 1
  }
  return N; // pair_level ≤ thresholds[0] → bottom division
}

export function parseDivision(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parsePairLevel(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

export function divisionLabelTh(n: number): string {
  return `Division ${n}`;
}

/**
 * Parse the raw `tournaments.pair_division_thresholds` jsonb-ish value into a
 * clean `number[]`. Filters out non-numeric / NaN / Infinity entries.
 * Returns `[]` when the input is not an array (incl. null/undefined).
 */
export function parseTournamentThresholds(raw: unknown): number[] {
  return Array.isArray(raw)
    ? raw.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    : [];
}

/**
 * Build a `pair_id → division (1..N)` lookup from a list of pairs and the
 * tournament thresholds. Pairs whose `pair_level` resolves to no division
 * (e.g., null level + non-empty thresholds → bottom division) are still
 * included via `computePairDivision`. Returns an empty map when thresholds
 * are empty (single-bucket mode).
 */
export function buildPairDivisionMap(
  pairs: { id: string; pair_level: string | null }[],
  thresholds: number[],
): Map<string, number> {
  const map = new Map<string, number>();
  if (thresholds.length === 0) return map;
  for (const p of pairs) {
    const d = computePairDivision(parsePairLevel(p.pair_level), thresholds);
    if (d != null) map.set(p.id, d);
  }
  return map;
}

export const DIVISION_COLORS: Array<{ border: string; bg: string; text: string }> = [
  { border: "border-amber-500/40",   bg: "bg-amber-500/10",   text: "text-amber-700 dark:text-amber-300" },
  { border: "border-sky-500/40",     bg: "bg-sky-500/10",     text: "text-sky-700 dark:text-sky-300" },
  { border: "border-emerald-500/40", bg: "bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-300" },
  { border: "border-violet-500/40",  bg: "bg-violet-500/10",  text: "text-violet-700 dark:text-violet-300" },
  { border: "border-rose-500/40",    bg: "bg-rose-500/10",    text: "text-rose-700 dark:text-rose-300" },
  { border: "border-cyan-500/40",    bg: "bg-cyan-500/10",    text: "text-cyan-700 dark:text-cyan-300" },
  { border: "border-pink-500/40",    bg: "bg-pink-500/10",    text: "text-pink-700 dark:text-pink-300" },
  { border: "border-lime-500/40",    bg: "bg-lime-500/10",    text: "text-lime-700 dark:text-lime-300" },
];

export function divisionTone(n: number): (typeof DIVISION_COLORS)[number] {
  return DIVISION_COLORS[(n - 1) % DIVISION_COLORS.length];
}
