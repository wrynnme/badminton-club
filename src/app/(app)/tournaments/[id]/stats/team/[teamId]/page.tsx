import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { loadStatsTournamentByAdmin } from "@/lib/tournament/stats-page-data";
import { computeTeamStats } from "@/lib/tournament/entity-stats";
import { StatsPageShell } from "@/components/tournament/stats/stats-page-shell";
import { TeamStatsView } from "@/components/tournament/stats/team-stats-view";

export const dynamic = "force-dynamic";

export default async function AdminTeamStatsPage({
  params,
}: {
  params: Promise<{ id: string; teamId: string }>;
}) {
  const { id, teamId } = await params;

  // Require session (stats are read-only, any logged-in user may view)
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=/tournaments/${id}/stats/team/${teamId}`);
  }

  const data = await loadStatsTournamentByAdmin(id);
  if (!data) notFound();

  // Validate the team belongs to this tournament
  const team = data.teams.find((t) => t.id === teamId);
  if (!team) notFound();

  const teamPairs = data.pairs.filter((p) => p.team_id === teamId);
  const teamById = new Map(data.teams.map((t) => [t.id, t]));
  const stats = computeTeamStats({
    teamId,
    pairs: data.pairs,
    matches: data.matches,
  });

  return (
    <StatsPageShell
      tournamentId={data.tournament.id}
      realtimeEnabled={data.settings.realtime_enabled}
      backHref={data.backHref}
    >
      <TeamStatsView
        stats={stats}
        team={team}
        teamPairs={teamPairs}
        competitorById={data.competitorById}
        teamById={teamById}
      />
    </StatsPageShell>
  );
}
