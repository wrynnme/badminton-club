import type { Game, Match } from "@/lib/types";

export const WIN_POINTS = 3;
export const DRAW_POINTS = 1;

/**
 * Compute total points scored from games array.
 * Returns { a: totalA, b: totalB }.
 */
export function sumGameScores(games: Game[]): { a: number; b: number } {
  return games.reduce(
    (acc, g) => ({ a: acc.a + g.a, b: acc.b + g.b }),
    { a: 0, b: 0 }
  );
}

/**
 * Determine winner from games (best-of-N: who won more games).
 * Returns 'a' | 'b' | 'draw'.
 */
export function gameWinner(games: Game[]): "a" | "b" | "draw" {
  let aWins = 0, bWins = 0;
  for (const g of games) {
    if (g.a > g.b) aWins++;
    else if (g.b > g.a) bWins++;
  }
  if (aWins > bWins) return "a";
  if (bWins > aWins) return "b";
  return "draw";
}

/**
 * League points: 3 for win, 1 for draw, 0 for loss.
 */
export function leaguePoints(wins: number, draws: number): number {
  return wins * WIN_POINTS + draws * DRAW_POINTS;
}

export type StandingRow = {
  competitorId: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  leaguePoints: number;
  pointDiff: number;
};

/**
 * Compute standings from completed matches.
 * Uses `team_a_id` / `team_b_id` OR `pair_a_id` / `pair_b_id` based on unit.
 */
export function computeStandings(
  matches: Match[],
  unit: "team" | "pair",
  competitorIds: string[]
): StandingRow[] {
  const map = new Map<string, StandingRow>(
    competitorIds.map((id) => [id, {
      competitorId: id, played: 0, wins: 0, draws: 0, losses: 0,
      pointsFor: 0, pointsAgainst: 0, leaguePoints: 0, pointDiff: 0,
    }])
  );

  for (const m of matches) {
    if (m.status !== "completed") continue;
    const aId = unit === "team" ? m.team_a_id : m.pair_a_id;
    const bId = unit === "team" ? m.team_b_id : m.pair_b_id;
    if (!aId || !bId) continue;

    const rowA = map.get(aId);
    const rowB = map.get(bId);
    if (!rowA || !rowB) continue;

    const totals = sumGameScores(m.games);
    const winner = gameWinner(m.games);

    rowA.played++; rowB.played++;
    rowA.pointsFor += totals.a; rowA.pointsAgainst += totals.b;
    rowB.pointsFor += totals.b; rowB.pointsAgainst += totals.a;

    if (winner === "a") { rowA.wins++; rowB.losses++; }
    else if (winner === "b") { rowB.wins++; rowA.losses++; }
    else { rowA.draws++; rowB.draws++; }
  }

  for (const row of map.values()) {
    row.leaguePoints = leaguePoints(row.wins, row.draws);
    row.pointDiff = row.pointsFor - row.pointsAgainst;
  }

  return Array.from(map.values()).sort((a, b) => {
    if (b.leaguePoints !== a.leaguePoints) return b.leaguePoints - a.leaguePoints;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    return b.pointsFor - a.pointsFor;
  });
}
