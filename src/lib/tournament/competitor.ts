import type { Team, PairWithPlayers, MatchUnit } from "@/lib/types";

export type Competitor = {
  id: string;
  name: string;
  color?: string | null;
  subtitle?: string;
  teamId?: string;
};

export function teamToCompetitor(t: Team): Competitor {
  return { id: t.id, name: t.name, color: t.color, teamId: t.id };
}

export function pairToCompetitor(p: PairWithPlayers, team?: Team): Competitor {
  const p1 = p.player1?.display_name ?? "";
  const p2 = p.player2?.display_name ?? "";
  const names = [p1, p2].filter(Boolean).join(" / ");
  return {
    id: p.id,
    name: p.display_pair_name || names || "คู่ไม่มีชื่อ",
    color: team?.color,
    subtitle: p.display_pair_name ? names : undefined,
    teamId: p.team_id,
  };
}

export function buildCompetitorMap(
  unit: MatchUnit,
  teams: Team[],
  pairs: PairWithPlayers[]
): Map<string, Competitor> {
  const map = new Map<string, Competitor>();
  if (unit === "team") {
    teams.forEach((t) => map.set(t.id, teamToCompetitor(t)));
  } else {
    const teamById = new Map(teams.map((t) => [t.id, t]));
    pairs.forEach((p) => map.set(p.id, pairToCompetitor(p, teamById.get(p.team_id))));
  }
  return map;
}
