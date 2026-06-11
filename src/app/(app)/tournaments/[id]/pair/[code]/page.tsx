import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { loadStatsTournamentByAdmin } from "@/lib/tournament/stats-page-data";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import { TvAutoRefresh } from "@/components/tournament/tv-auto-refresh";
import { PairScheduleView } from "@/components/tournament/pair-schedule-view";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function AdminPairSchedulePage({
  params,
}: {
  params: Promise<{ id: string; code: string }>;
}) {
  const { id, code } = await params;

  // Require session (read-only, any logged-in user may view) — mirrors stats pages.
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=/tournaments/${id}/pair/${code}`);
  }

  // `code` is a pair UUID (spec uses the [code] segment name; pairs have no pair_code).
  let pairId: string;
  try {
    pairId = decodeURIComponent(code);
  } catch {
    notFound();
  }

  const data = await loadStatsTournamentByAdmin(id);
  if (!data) notFound();
  if (data.tournament.match_unit !== "pair") notFound();

  const pair = data.pairs.find((p) => p.id === pairId);
  if (!pair) notFound();

  const t = await getTranslations("tournament");

  return (
    <TournamentLiveWrapper
      tournamentId={data.tournament.id}
      realtimeEnabled={data.settings.realtime_enabled}
    >
      <TvAutoRefresh intervalMs={30_000} />

      <div className="min-h-screen bg-background text-foreground">
        <div className="max-w-xl mx-auto px-4 py-6 space-y-4">
          <Link
            href={data.backHref}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("page.pairPageBack")}
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
