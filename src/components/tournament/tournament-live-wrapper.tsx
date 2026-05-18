"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";

const REFRESH_DEBOUNCE_MS = 400;

export function TournamentLiveWrapper({
  tournamentId,
  isOngoing,
  realtimeEnabled = true,
  children,
}: {
  tournamentId: string;
  isOngoing: boolean;
  realtimeEnabled?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOngoing) return;
    if (!realtimeEnabled) return;

    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
    };

    const sb = createClient();
    const channel = sb
      .channel(`tournament:${tournamentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `tournament_id=eq.${tournamentId}` },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournaments", filter: `id=eq.${tournamentId}` },
        scheduleRefresh
      )
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED");
      });

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      sb.removeChannel(channel);
    };
  }, [tournamentId, isOngoing, realtimeEnabled, router]);

  return (
    <>
      {live && (
        <div className="fixed top-3 right-3 z-50">
          <Badge variant="default" className="text-xs gap-1.5 bg-green-600 hover:bg-green-600">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            LIVE
          </Badge>
        </div>
      )}
      {children}
    </>
  );
}
