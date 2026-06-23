import { getTranslations } from "next-intl/server";
import { Users } from "lucide-react";
import { buildHourlyShuttleSlots } from "@/lib/club/cost-summary";
import type { Club, ClubPlayer } from "@/lib/types";

/**
 * Per-hour attendance: how many players cover each 1-hour slot of the session.
 * Slots + headcount come from `buildHourlyShuttleSlots` — the SAME shared presence
 * source the by_time shuttle split divides among — so this grid and the cost split
 * agree (including cross-midnight sessions). Pure / server-renderable.
 */
export async function HourlyHeadcount({ club, players }: { club: Club; players: ClubPlayer[] }) {
  const t = await getTranslations("club.hourly");
  if (players.length === 0) return null;
  const slots = buildHourlyShuttleSlots(club, players);
  if (slots.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {slots.map((s) => (
        <div
          key={s.label}
          className="rounded-lg border bg-card px-3 py-2.5 flex flex-col gap-0.5"
        >
          <span className="text-xs text-muted-foreground tabular-nums">{s.label}</span>
          <span className="flex items-center gap-1.5 text-lg font-semibold tabular-nums">
            <Users className="h-4 w-4 text-muted-foreground shrink-0" />
            {t("people", { count: s.count })}
          </span>
        </div>
      ))}
    </div>
  );
}
