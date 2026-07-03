"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

const REFRESH_DEBOUNCE_MS = 800;

/**
 * Shared scaffolding for realtime auto-refresh wrappers (TournamentLiveWrapper /
 * ClubLiveWrapper): debounced router.refresh() on channel events + `live`
 * connection state + channel/timer cleanup. Callers wire their channel-specific
 * listeners (postgres_changes vs broadcast) in `wire`; changes to debounce or
 * subscribe-status handling land here once for every wrapper.
 *
 * `wire` is read through a ref so an inline closure at the call site doesn't
 * retrigger the effect — the subscription only rebuilds when `channelName` or
 * `enabled` change.
 */
export function useLiveRefresh({
  channelName,
  enabled = true,
  wire,
}: {
  channelName: string;
  enabled?: boolean;
  wire: (channel: RealtimeChannel, scheduleRefresh: () => void) => RealtimeChannel;
}): boolean {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wireRef = useRef(wire);
  wireRef.current = wire;

  useEffect(() => {
    if (!enabled) return;

    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
    };

    const sb = createClient();
    const channel = wireRef.current(sb.channel(channelName), scheduleRefresh).subscribe(
      (status) => {
        setLive(status === "SUBSCRIBED");
      },
    );

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      sb.removeChannel(channel);
    };
  }, [channelName, enabled, router]);

  return live;
}
