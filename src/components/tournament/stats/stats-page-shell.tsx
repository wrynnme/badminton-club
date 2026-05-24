import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import type { ReactNode } from "react";

export function StatsPageShell({
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
          กลับ
        </Link>
        {children}
      </div>
    </TournamentLiveWrapper>
  );
}
