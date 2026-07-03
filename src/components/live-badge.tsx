import { Badge } from "@/components/ui/badge";

/**
 * Realtime-connected indicator shared by ClubLiveWrapper and
 * TournamentLiveWrapper. Hidden below `sm` by design (v0.16.1) — the badge
 * overlapped content on phones and realtime still works without it.
 */
export function LiveBadge() {
  return (
    <div className="hidden sm:block fixed top-3 right-3 z-50">
      <Badge variant="default" className="text-xs gap-1.5 bg-green-600 hover:bg-green-600">
        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        LIVE
      </Badge>
    </div>
  );
}
