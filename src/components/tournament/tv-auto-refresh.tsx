"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polling fallback for TV view — refreshes the route every `intervalMs`
 * regardless of tournament status. Complements `TournamentLiveWrapper`'s
 * Supabase Realtime subscription which only activates when status="ongoing".
 */
export function TvAutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
