"use client";

import { useLiveRefresh } from "@/lib/hooks/use-live-refresh";
import { LiveBadge } from "@/components/live-badge";

export function TournamentLiveWrapper({
  tournamentId,
  realtimeEnabled = true,
  children,
}: {
  tournamentId: string;
  realtimeEnabled?: boolean;
  children: React.ReactNode;
}) {
  const live = useLiveRefresh({
    channelName: `tournament:${tournamentId}`,
    enabled: realtimeEnabled,
    wire: (channel, scheduleRefresh) =>
      channel
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "matches", filter: `tournament_id=eq.${tournamentId}` },
          scheduleRefresh
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tournaments", filter: `id=eq.${tournamentId}` },
          scheduleRefresh
        ),
  });

  return (
    <>
      {live && <LiveBadge />}
      {children}
    </>
  );
}
