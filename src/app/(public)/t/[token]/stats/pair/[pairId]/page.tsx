import { notFound } from "next/navigation";
import { loadStatsTournamentByToken } from "@/lib/tournament/stats-page-data";
import { computePairStats } from "@/lib/tournament/entity-stats";
import { StatsPageShell } from "@/components/tournament/stats/stats-page-shell";
import { PairStatsView } from "@/components/tournament/stats/pair-stats-view";

export const dynamic = "force-dynamic";

export default async function PublicPairStatsPage({
  params,
}: {
  params: Promise<{ token: string; pairId: string }>;
}) {
  const { token, pairId } = await params;
  const data = await loadStatsTournamentByToken(token);
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
