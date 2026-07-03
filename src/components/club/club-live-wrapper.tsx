"use client";

import { useLiveRefresh } from "@/lib/hooks/use-live-refresh";
import { LiveBadge } from "@/components/live-badge";

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
  const live = useLiveRefresh({
    channelName: `club:${clubId}`,
    enabled: realtimeEnabled,
    wire: (channel, scheduleRefresh) =>
      channel.on("broadcast", { event: "change" }, scheduleRefresh),
  });

  return (
    <>
      {live && <LiveBadge />}
      {children}
    </>
  );
}
