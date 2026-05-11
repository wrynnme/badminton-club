import { Trophy } from "lucide-react";
import { computeStandings } from "@/lib/tournament/scoring";
import type { Match } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

export function StandingsTable({
  matches,
  competitors,
  unit,
}: {
  matches: Match[];
  competitors: Competitor[];
  unit: "team" | "pair";
}) {
  const rows = computeStandings(matches, unit, competitors.map((c) => c.id));
  const compById = new Map(competitors.map((c) => [c.id, c]));

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted-foreground border-b">
          <th className="text-left pb-1 font-normal">{unit === "team" ? "ทีม" : "คู่"}</th>
          <th className="text-center pb-1 font-normal w-7">P</th>
          <th className="text-center pb-1 font-normal w-7">W</th>
          <th className="text-center pb-1 font-normal w-7">D</th>
          <th className="text-center pb-1 font-normal w-7">L</th>
          <th className="text-center pb-1 font-normal w-10">+/-</th>
          <th className="text-center pb-1 font-normal w-8">Pts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const c = compById.get(r.competitorId);
          return (
            <tr key={r.competitorId} className={i === 0 ? "font-semibold" : ""}>
              <td className="py-0.5">
                <div className="flex items-center gap-1.5">
                  {i === 0 && r.played > 0 && <Trophy className="h-3 w-3 text-yellow-500 shrink-0" />}
                  {c?.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color }} />}
                  <span className="truncate">{c?.name ?? "—"}</span>
                </div>
                {c?.subtitle && <div className="text-[10px] text-muted-foreground pl-3.5 truncate font-normal">{c.subtitle}</div>}
              </td>
              <td className="text-center tabular-nums">{r.played}</td>
              <td className="text-center tabular-nums">{r.wins}</td>
              <td className="text-center tabular-nums">{r.draws}</td>
              <td className="text-center tabular-nums">{r.losses}</td>
              <td className="text-center tabular-nums">{r.pointDiff > 0 ? "+" : ""}{r.pointDiff}</td>
              <td className="text-center font-semibold tabular-nums">{r.leaguePoints}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
