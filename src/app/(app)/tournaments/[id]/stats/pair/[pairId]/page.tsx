import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import { PairStatsView } from "@/components/tournament/stats/pair-stats-view";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { computePairStats } from "@/lib/tournament/entity-stats";
import { parseSettings } from "@/lib/tournament/settings";
import type { Tournament, Team, PairWithPlayers, Match } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminPairStatsPage({
  params,
}: {
  params: Promise<{ id: string; pairId: string }>;
}) {
  const { id, pairId } = await params;
  const sb = await createAdminClient();

  // Require session (stats are read-only, any logged-in user may view)
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=/tournaments/${id}/stats/pair/${pairId}`);
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

  // Validate the pair belongs to this tournament
  const pair = pairs.find((p) => p.id === pairId);
  if (!pair) notFound();

  const competitorById = buildCompetitorMap("pair", teams, pairs);
  const stats = computePairStats({ pairId, matches: allMatches });
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

        <PairStatsView
          stats={stats}
          pair={pair}
          competitorById={competitorById}
        />
      </div>
    </TournamentLiveWrapper>
  );
}
