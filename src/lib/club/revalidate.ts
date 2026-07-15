import { revalidatePath } from "next/cache";

/**
 * Single revalidate call covering the whole club-series subtree — list, series
 * home, session, and join pages (the URL restructure lands in a later P2
 * slice; `'layout'` mode already invalidates every path nested under `/clubs`
 * once those routes exist, mirroring `revalidatePath('/t/[token]', 'layout')`
 * in `src/lib/actions/tournaments.ts`). Use this for every new club-series
 * action instead of `revalidatePath('/clubs')` + a hand-picked list of
 * sub-paths — existing club/session actions are NOT touched in this slice.
 */
export function revalidateClubTree(): void {
  revalidatePath("/clubs", "layout");
}
