import { Users } from "lucide-react";
import type { Club, ClubPlayer } from "@/lib/types";

function toMin(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Per-hour attendance: how many players are present in each 1-hour slot of the
 * session, using each player's effective window (override or full club window).
 * Pure / server-renderable.
 */
export function HourlyHeadcount({ club, players }: { club: Club; players: ClubPlayer[] }) {
  const s0 = toMin(club.start_time);
  const s1 = toMin(club.end_time);
  if (s1 <= s0 || players.length === 0) return null;

  const slots: { start: number; end: number; count: number }[] = [];
  for (let t = s0; t < s1; t += 60) {
    const end = Math.min(t + 60, s1);
    const count = players.filter((p) => {
      const ps = p.start_time ? toMin(p.start_time) : s0;
      const pe = p.end_time ? toMin(p.end_time) : s1;
      return ps <= t && pe >= end;
    }).length;
    slots.push({ start: t, end, count });
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {slots.map((s) => (
        <div
          key={s.start}
          className="rounded-lg border bg-card px-3 py-2.5 flex flex-col gap-0.5"
        >
          <span className="text-xs text-muted-foreground tabular-nums">
            {fmt(s.start)}–{fmt(s.end)}
          </span>
          <span className="flex items-center gap-1.5 text-lg font-semibold tabular-nums">
            <Users className="h-4 w-4 text-muted-foreground shrink-0" />
            {s.count} คน
          </span>
        </div>
      ))}
    </div>
  );
}
