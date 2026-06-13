import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { loadStatsTournamentByToken } from "@/lib/tournament/stats-page-data";
import { computePlayerStats } from "@/lib/tournament/entity-stats";
import { StatsPageShell } from "@/components/tournament/stats/stats-page-shell";
import { PlayerStatsView } from "@/components/tournament/stats/player-stats-view";
import { getGlobalLevelsAction } from "@/lib/actions/levels";
import type { TeamPlayer } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PublicPlayerStatsPage({
  params,
}: {
  params: Promise<{ token: string; playerId: string }>;
}) {
  const { token, playerId } = await params;
  const [data, levels] = await Promise.all([
    loadStatsTournamentByToken(token),
    getGlobalLevelsAction(),
  ]);
  if (!data) notFound();

  // Fetch player directly from team_players; validate it belongs to this tournament
  const sb = await createAdminClient();
  const { data: playerData } = await sb
    .from("team_players")
    .select("*")
    .eq("id", playerId)
    .maybeSingle();

  if (!playerData) notFound();
  const player = playerData as TeamPlayer;

  // Ensure the player's team belongs to this tournament
  const teamBelongs = data.teams.some((team) => team.id === player.team_id);
  if (!teamBelongs) notFound();

  const team = data.teams.find((team) => team.id === player.team_id);
  const pairById = new Map(data.pairs.map((p) => [p.id, p]));
  const stats = computePlayerStats({
    playerId,
    pairs: data.pairs,
    matches: data.matches,
  });

  return (
    <StatsPageShell
      tournamentId={data.tournament.id}
      realtimeEnabled={data.settings.realtime_enabled}
      backHref={data.backHref}
    >
      <PlayerStatsView
        stats={stats}
        player={player}
        team={team}
        pairById={pairById}
        competitorById={data.competitorById}
        levels={levels}
      />
    </StatsPageShell>
  );
}
