import { z } from "zod";
import type { Match } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

/**
 * Prize template — the owner-configured award tiers shown on the prize-summary
 * page. Stored on the standalone `tournaments.prize_template jsonb` column
 * (mirrors `courts`), NOT inside `settings`. `cash`/`trophy` are ceremony
 * display metadata only; they do not affect scoring or seeding.
 */
export const PrizeTemplateEntrySchema = z.object({
  rank: z.number().int().min(1).max(99),
  label: z.string().trim().min(1).max(60),
  cash: z.number().int().min(0).max(100_000_000).default(0),
  trophy: z.boolean().default(false),
});

export const PrizeTemplateSchema = z.array(PrizeTemplateEntrySchema).max(20);

export type PrizeTemplateEntry = z.infer<typeof PrizeTemplateEntrySchema>;

/**
 * Tolerant parse of the raw jsonb column. Drops any malformed entry instead of
 * throwing (defends against manual DB edits / partial writes), then sorts by
 * rank ascending so the ceremony list always reads 1 → N.
 */
export function parsePrizeTemplate(raw: unknown): PrizeTemplateEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: PrizeTemplateEntry[] = [];
  const seenRanks = new Set<number>();
  for (const item of raw) {
    const parsed = PrizeTemplateEntrySchema.safeParse(item);
    // Drop duplicate ranks (keep first) so consumers can safely key rows by rank
    // and each placement maps to exactly one row.
    if (parsed.success && !seenRanks.has(parsed.data.rank)) {
      seenRanks.add(parsed.data.rank);
      out.push(parsed.data);
    }
  }
  return out.sort((a, b) => a.rank - b.rank);
}

// ─── Auto-computed bracket results ──────────────────────────────────────────

export type PrizeResult = {
  /** Final-match winner. null until the final is completed. */
  champion: Competitor | null;
  /** Final-match loser. null until the final is completed. */
  runnerUp: Competitor | null;
  /** Losers of the matches feeding the final (3rd–4th tier). May be empty. */
  semifinalists: Competitor[];
  /** True once the terminal/final match is completed with a winner. */
  finalDecided: boolean;
  /** True when the scope has any knockout bracket at all. */
  hasBracket: boolean;
};

/** Side ids of a match, pair-mode first then team-mode (one of each is null). */
function sideIds(m: Match): { a: string | null; b: string | null } {
  return { a: m.pair_a_id ?? m.team_a_id, b: m.pair_b_id ?? m.team_b_id };
}

const EMPTY: PrizeResult = {
  champion: null,
  runnerUp: null,
  semifinalists: [],
  finalDecided: false,
  hasBracket: false,
};

/**
 * Derive champion / runner-up / semifinalists from a single scope's matches
 * (the caller pre-filters by class or division — pass only that scope's matches).
 *
 * - **Final** = the terminal knockout match: `next_match_id === null` in the
 *   `upper` bracket (single-elim) or the `grand_final` (double-elim). When more
 *   than one qualifies, the highest `round_number` wins (grand_final > upper final).
 * - **Champion** = `final.winner_id`; **runner-up** = the final's losing side.
 * - **Semifinalists** = the losing sides of every completed match that feeds the
 *   final (`next_match_id === final.id`), de-duplicated. In single-elim that is
 *   the two semifinals; in double-elim it is the upper-final + lower-final losers.
 *
 * BYE walkovers are tolerated: a null losing side simply contributes nobody.
 */
export function computePrizeResult(
  matches: Match[],
  competitorMap: Map<string, Competitor>,
): PrizeResult {
  const ko = matches.filter(
    (m) => m.bracket != null || m.round_type === "knockout",
  );
  if (ko.length === 0) return EMPTY;

  const terminals = ko.filter(
    (m) =>
      m.next_match_id === null &&
      (m.bracket === "upper" || m.bracket === "grand_final"),
  );
  const final = terminals.sort((a, b) => b.round_number - a.round_number)[0] ?? null;
  if (!final) return { ...EMPTY, hasBracket: true };

  const resolve = (id: string | null): Competitor | null =>
    id ? competitorMap.get(id) ?? null : null;

  let champion: Competitor | null = null;
  let runnerUp: Competitor | null = null;
  const finalDecided = final.status === "completed" && !!final.winner_id;
  if (finalDecided) {
    const { a, b } = sideIds(final);
    champion = resolve(final.winner_id);
    runnerUp = resolve(final.winner_id === a ? b : a);
  }

  const semifinalists: Competitor[] = [];
  const seen = new Set<string>();
  // Exclude champion + runner-up up front: in double-elim the grand-final loser
  // (runner-up) also loses as a feeder of the final, so without this it would be
  // double-listed as a semifinalist.
  if (champion) seen.add(champion.id);
  if (runnerUp) seen.add(runnerUp.id);
  for (const f of ko) {
    if (f.next_match_id !== final.id) continue;
    if (f.status !== "completed" || !f.winner_id) continue;
    const { a, b } = sideIds(f);
    const loserId = f.winner_id === a ? b : a;
    if (loserId && !seen.has(loserId)) {
      seen.add(loserId);
      const c = resolve(loserId);
      if (c) semifinalists.push(c);
    }
  }

  return { champion, runnerUp, semifinalists, finalDecided, hasBracket: true };
}
