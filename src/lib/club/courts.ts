// Pure court-occupancy helpers shared by the club queue panel (occupancy grid +
// default-court selection). Kept framework-free so they're unit-testable.

import type { ClubMatch } from "@/lib/types";

/**
 * Map of court name → the in-progress match occupying it. Single source of truth
 * for "which courts are busy" — both the occupancy grid and `firstFreeCourt`
 * derive from this so they can't disagree.
 */
export function occupiedCourtMap(matches: ClubMatch[]): Map<string, ClubMatch> {
  const m = new Map<string, ClubMatch>();
  for (const mt of matches) {
    if (mt.status === "in_progress" && mt.court) m.set(mt.court, mt);
  }
  return m;
}

/**
 * Default court for a new manual match: the first court with no in-progress match
 * on it (occupied courts stay selectable — a manual match is inserted as pending
 * and doesn't claim the court until started). Falls back to the first court, then "".
 */
export function firstFreeCourt(courts: string[], matches: ClubMatch[]): string {
  const occupied = occupiedCourtMap(matches);
  return courts.find((c) => !occupied.has(c)) ?? courts[0] ?? "";
}
