"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LiveBadge } from "@/components/live-badge";

const REFRESH_DEBOUNCE_MS = 800;

export function TournamentLiveWrapper({
  tournamentId,
  realtimeEnabled = true,
  children,
}: {
  tournamentId: string;
  realtimeEnabled?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
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
  }, [tournamentId, realtimeEnabled, router]);

  return (
    <>
      {live && <LiveBadge />}
      {children}
    </>
  );
}
