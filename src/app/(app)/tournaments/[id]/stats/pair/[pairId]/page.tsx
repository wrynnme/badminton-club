import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { loadStatsTournamentByAdmin } from "@/lib/tournament/stats-page-data";
import { computePairStats } from "@/lib/tournament/entity-stats";
import { StatsPageShell } from "@/components/tournament/stats/stats-page-shell";
import { PairStatsView } from "@/components/tournament/stats/pair-stats-view";

export const dynamic = "force-dynamic";

export default async function AdminPairStatsPage({
  params,
}: {
  params: Promise<{ id: string; pairId: string }>;
}) {
  const { id, pairId } = await params;

  // Require session (stats are read-only, any logged-in user may view)
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=/tournaments/${id}/stats/pair/${pairId}`);
  }

  const data = await loadStatsTournamentByAdmin(id);
  if (!data) notFound();

  const pair = data.pairs.find((p) => p.id === pairId);
  if (!pair) notFound();

  const stats = computePairStats({ pairId, matches: data.matches });

  return (
    <StatsPageShell
      tournamentId={data.tournament.id}
      realtimeEnabled={data.settings.realtime_enabled}
      backHref={data.backHref}
    >
      <PairStatsView
        stats={stats}
        pair={pair}
        competitorById={data.competitorById}
      />
    </StatsPageShell>
  );
}
