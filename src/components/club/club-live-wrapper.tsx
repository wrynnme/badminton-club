"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";

const REFRESH_DEBOUNCE_MS = 800;

/**
 * Realtime auto-refresh for the club detail page (queue + players + cost).
 *
 * Unlike TournamentLiveWrapper (postgres_changes), club tables are RLS-locked from
 * the anon browser client for PII safety (migration 20260614000100). So instead of
 * subscribing to row changes — which would require re-opening an anon SELECT grant —
 * we subscribe to a PUBLIC Broadcast topic `club:<id>`. A DB trigger
 * (club_queue_broadcast) fires realtime.send(..., private=false) carrying only
 * {club_id, table} — a signal with no row data — whenever club_matches/club_players
 * change. On that signal we debounce a router.refresh(); the actual data is re-fetched
 * server-side (service-role), so no sensitive data ever rides the realtime channel.
 */
export function ClubLiveWrapper({
  clubId,
  realtimeEnabled = true,
  children,
}: {
  clubId: string;
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
      .channel(`club:${clubId}`)
      .on("broadcast", { event: "change" }, scheduleRefresh)
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED");
      });

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      sb.removeChannel(channel);
    };
  }, [clubId, realtimeEnabled, router]);

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
