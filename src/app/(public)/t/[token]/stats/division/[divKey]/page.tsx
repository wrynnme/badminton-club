import { notFound } from "next/navigation";
import { loadStatsTournamentByToken } from "@/lib/tournament/stats-page-data";
import { computeDivisionStats } from "@/lib/tournament/entity-stats";
import { computePairDivision, parsePairLevel } from "@/lib/tournament/divisions";
import { StatsPageShell } from "@/components/tournament/stats/stats-page-shell";
import { DivisionStatsView } from "@/components/tournament/stats/division-stats-view";

export const dynamic = "force-dynamic";

export default async function PublicDivisionStatsPage({
  params,
}: {
  params: Promise<{ token: string; divKey: string }>;
}) {
  const { token, divKey } = await params;
  const division = parseInt(decodeURIComponent(divKey), 10);

  const data = await loadStatsTournamentByToken(token);
  if (!data) notFound();

  // Validate division param is within range
  const thresholds: number[] = data.tournament.pair_division_thresholds ?? [];
  const maxDivision = thresholds.length + 1;
  if (!Number.isFinite(division) || division < 1 || division > maxDivision) {
    notFound();
  }

  // Filter pairs belonging to this division
  const divisionPairs =
    thresholds.length > 0
      ? data.pairs.filter(
          (p) => computePairDivision(parsePairLevel(p.pair_level), thresholds) === division
        )
      : data.pairs; // no split → all pairs

  const stats = computeDivisionStats({
    division,
    pairs: data.pairs,
    matches: data.matches,
    thresholds,
  });

  return (
    <StatsPageShell
      tournamentId={data.tournament.id}
      realtimeEnabled={data.settings.realtime_enabled}
      backHref={data.backHref}
    >
      <DivisionStatsView
        stats={stats}
        division={division}
        divisionPairs={divisionPairs}
        competitorById={data.competitorById}
      />
    </StatsPageShell>
  );
}
