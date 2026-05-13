"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";

export function TournamentLiveWrapper({
  tournamentId,
  isOngoing,
  children,
}: {
  tournamentId: string;
  isOngoing: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!isOngoing) return;

    const sb = createClient();
    const channel = sb
      .channel(`tournament:${tournamentId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "matches", filter: `tournament_id=eq.${tournamentId}` },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches", filter: `tournament_id=eq.${tournamentId}` },
        () => router.refresh()
      )
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED");
      });

    return () => { sb.removeChannel(channel); };
  }, [tournamentId, isOngoing, router]);

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
