import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import type { ReactNode } from "react";

export async function StatsPageShell({
  tournamentId,
  realtimeEnabled,
  backHref,
  children,
}: {
  tournamentId: string;
  realtimeEnabled: boolean;
  backHref: string;
  children: ReactNode;
}) {
  const t = await getTranslations("stats.shared");

  return (
    <TournamentLiveWrapper
      tournamentId={tournamentId}
      realtimeEnabled={realtimeEnabled}
    >
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backLink")}
        </Link>
        {children}
      </div>
    </TournamentLiveWrapper>
  );
}
