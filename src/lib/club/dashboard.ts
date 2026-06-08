// Club dashboard aggregations — pure, testable. Derives the headline counts and
// chart series from the live club_players + club_matches rows. Games per player,
// court usage and total games count COMPLETED matches only. Shuttles count
// in_progress + completed (mirroring the cost basis — a live match is already
// consuming shuttles); pending / cancelled are always excluded. The cost figure
// is computed separately via cost-summary.ts (the canonical money path).

import type { ClubPlayer, ClubMatch } from "@/lib/types";

export type CourtUsage = { court: string; matches: number };

export type ClubDashboardData = {
  activePlayers: number;
  reservePlayers: number;
  totalPlayers: number;
  completedMatches: number;
  inProgressMatches: number;
  pendingMatches: number;
  /** Completed matches = games actually played this session. */
  totalGames: number;
  /** Σ shuttles_used over in_progress + completed matches (the cost basis). */
  totalShuttles: number;
  /** club_players.id → completed-match appearances. */
  gamesByPlayer: Map<string, number>;
  /** Completed matches per court, sorted by count desc then court name asc. */
  courtUsage: CourtUsage[];
};

type DashPlayer = Pick<ClubPlayer, "id" | "status">;
type DashMatch = Pick<
  ClubMatch,
  "status" | "court" | "shuttles_used" | "side_a_player1" | "side_a_player2" | "side_b_player1" | "side_b_player2"
>;

/** Non-null player ids on court for a match (2 singles / 4 doubles). */
function participants(m: DashMatch): string[] {
  return [m.side_a_player1, m.side_a_player2, m.side_b_player1, m.side_b_player2].filter(
    (id): id is string => Boolean(id),
  );
}

export function computeClubDashboard(
  players: DashPlayer[],
  matches: DashMatch[],
): ClubDashboardData {
  const activePlayers = players.filter((p) => p.status === "active").length;
  const reservePlayers = players.filter((p) => p.status === "reserve").length;

  const completed = matches.filter((m) => m.status === "completed");
  const inProgressMatches = matches.filter((m) => m.status === "in_progress").length;
  const pendingMatches = matches.filter((m) => m.status === "pending").length;

  // Shuttles "used so far" mirror the cost basis: a live (in_progress) match is
  // already consuming shuttles, so include it alongside completed.
  const totalShuttles = matches
    .filter((m) => m.status === "completed" || m.status === "in_progress")
    .reduce((s, m) => s + Math.max(0, m.shuttles_used), 0);

  const gamesByPlayer = new Map<string, number>();
  const courtCounts = new Map<string, number>();
  for (const m of completed) {
    for (const id of participants(m)) {
      gamesByPlayer.set(id, (gamesByPlayer.get(id) ?? 0) + 1);
    }
    const court = (m.court ?? "").toString();
    if (court) courtCounts.set(court, (courtCounts.get(court) ?? 0) + 1);
  }

  const courtUsage: CourtUsage[] = [...courtCounts.entries()]
    .map(([court, n]) => ({ court, matches: n }))
    .sort((a, b) => b.matches - a.matches || a.court.localeCompare(b.court));

  return {
    activePlayers,
    reservePlayers,
    totalPlayers: players.length,
    completedMatches: completed.length,
    inProgressMatches,
    pendingMatches,
    totalGames: completed.length,
    totalShuttles,
    gamesByPlayer,
    courtUsage,
  };
}
