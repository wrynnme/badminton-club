import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import { PlayerStatsView } from "@/components/tournament/stats/player-stats-view";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { computePlayerStats } from "@/lib/tournament/entity-stats";
import { parseSettings } from "@/lib/tournament/settings";
import type { Tournament, Team, TeamPlayer, PairWithPlayers, Match } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminPlayerStatsPage({
  params,
}: {
  params: Promise<{ id: string; playerId: string }>;
}) {
  const { id, playerId } = await params;
  const sb = await createAdminClient();

  // Require session (stats are read-only, any logged-in user may view)
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=/tournaments/${id}/stats/player/${playerId}`);
  }

  // Fetch tournament + matches + teams in parallel; pairs follow (need teamIds)
  const [{ data: tournament }, matchesRes, teamsRes] = await Promise.all([
    sb.from("tournaments").select("*").eq("id", id).maybeSingle(),
    sb.from("matches").select("*").eq("tournament_id", id).order("match_number"),
    sb.from("teams").select("*").eq("tournament_id", id).order("created_at"),
  ]);

  if (!tournament) notFound();
  const t = tournament as Tournament;

  const teamIdList = (teamsRes.data ?? []).map((x) => x.id);
  const pairsRes = teamIdList.length
    ? await sb
        .from("pairs")
        .select(
          "*, player1:team_players!player_id_1(*), player2:team_players!player_id_2(*)"
        )
        .in("team_id", teamIdList)
        .order("created_at")
    : { data: [] };

  const teams: Team[] = (teamsRes.data ?? []) as Team[];
  const allMatches: Match[] = (matchesRes.data ?? []) as Match[];
  const pairs: PairWithPlayers[] = (pairsRes.data ?? []) as unknown as PairWithPlayers[];

  // Fetch player directly from team_players; validate it belongs to this tournament
  const { data: playerData } = await sb
    .from("team_players")
    .select("*")
    .eq("id", playerId)
    .maybeSingle();

  if (!playerData) notFound();
  const player = playerData as TeamPlayer;

  // Ensure the player's team belongs to this tournament
  const teamBelongs = teams.some((team) => team.id === player.team_id);
  if (!teamBelongs) notFound();

  const team = teams.find((team) => team.id === player.team_id);

  const competitorById = buildCompetitorMap("pair", teams, pairs);
  const pairById = new Map(pairs.map((p) => [p.id, p]));
  const stats = computePlayerStats({ playerId, pairs, matches: allMatches });
  const settings = parseSettings(t.settings);

  return (
    <TournamentLiveWrapper tournamentId={t.id} realtimeEnabled={settings.realtime_enabled}>
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <Link
          href={`/tournaments/${id}?tab=pair`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับ
        </Link>

        <PlayerStatsView
          stats={stats}
          player={player}
          team={team}
          pairById={pairById}
          competitorById={competitorById}
        />
      </div>
    </TournamentLiveWrapper>
  );
}
