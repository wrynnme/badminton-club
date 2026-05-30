import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { loadStatsTournamentByToken } from "@/lib/tournament/stats-page-data";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import { TvAutoRefresh } from "@/components/tournament/tv-auto-refresh";
import { PairScheduleView } from "@/components/tournament/pair-schedule-view";

export const dynamic = "force-dynamic";

export default async function PublicPairSchedulePage({
  params,
}: {
  params: Promise<{ token: string; code: string }>;
}) {
  const { token, code } = await params;

  // `code` is a pair UUID (spec uses the [code] segment name; pairs have no pair_code).
  let pairId: string;
  try {
    pairId = decodeURIComponent(code);
  } catch {
    notFound();
  }

  const data = await loadStatsTournamentByToken(token);
  if (!data) notFound();
  if (data.tournament.match_unit !== "pair") notFound();

  const pair = data.pairs.find((p) => p.id === pairId);
  if (!pair) notFound();

  return (
    <TournamentLiveWrapper
      tournamentId={data.tournament.id}
      realtimeEnabled={data.settings.realtime_enabled}
    >
      {/* Polling fallback: 30s (matches the court referee view) */}
      <TvAutoRefresh intervalMs={30_000} />

      <div className="min-h-screen bg-background text-foreground">
        <div className="max-w-xl mx-auto px-4 py-6 space-y-4">
          <Link
            href={`/t/${token}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            กลับ
          </Link>

          <PairScheduleView
            pair={pair}
            matches={data.matches}
            competitorById={data.competitorById}
            unit={data.tournament.match_unit}
          />
        </div>
      </div>
    </TournamentLiveWrapper>
  );
}
