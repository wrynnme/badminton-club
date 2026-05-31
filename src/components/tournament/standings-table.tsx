import { Trophy, CalendarClock } from "lucide-react";
import { computeStandings } from "@/lib/tournament/scoring";
import { EntityLink } from "@/components/tournament/stats/entity-link";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
/* my-matches-link: ดูแมตช์ entry point — ลบ block นี้ (+ matching <th>) เพื่อถอด entry point */
import { PairScheduleLink } from "@/components/tournament/pair-schedule-link";
/* end my-matches-link */
import type { Match } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

export function StandingsSortKeyNote() {
  return (
    <p className="mt-1.5 text-[10px] text-muted-foreground">
      เกณฑ์จัดอันดับ: คะแนน → ผลต่างแต้ม → แต้มที่ได้
    </p>
  );
}

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
    <>
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted-foreground border-b">
          <th className="text-left pb-1 font-normal">{unit === "team" ? "ทีม" : "คู่"}</th>
          <th className="text-center pb-1 font-normal w-7">P</th>
          <th className="text-center pb-1 font-normal w-7">W</th>
          <th className="text-center pb-1 font-normal w-7">D</th>
          <th className="text-center pb-1 font-normal w-7">L</th>
          <th className="text-center pb-1 font-normal w-10">+/-</th>
          <th className="text-center pb-1 font-normal w-8">
            <Tooltip>
              <TooltipTrigger
                render={
                  <span tabIndex={0} className="cursor-help underline decoration-dotted decoration-muted-foreground/40">
                    Pts
                  </span>
                }
              />
              <TooltipContent>ชนะ = 3 · เสมอ = 1 · แพ้ = 0</TooltipContent>
            </Tooltip>
          </th>
          {/* my-matches-link: ดูแมตช์ header (pair only) — ลบ <th> นี้คู่กับ <td> ด้านล่างเพื่อถอด entry point */}
          {unit === "pair" && <th className="w-6 pb-1 font-normal" aria-label="ดูแมตช์" />}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const c = compById.get(r.competitorId);
          return (
            <tr key={r.competitorId} className={i === 0 ? "font-semibold" : ""}>
              <td className="py-0.5">
                <div className="flex items-center gap-1.5">
                  {i === 0 && r.played > 0 && <Trophy className="h-3 w-3 text-brand shrink-0" />}
                  {c?.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color }} />}
                  <EntityLink entityType={unit === "team" ? "team" : "pair"} entityId={c?.id}>
                    <span className="truncate">{c?.name ?? "—"}</span>
                  </EntityLink>
                </div>
                {c?.subtitle && <div className="text-[10px] text-muted-foreground pl-3.5 truncate font-normal">{c.subtitle}</div>}
              </td>
              <td className="text-center tabular-nums">{r.played}</td>
              <td className="text-center tabular-nums">{r.wins}</td>
              <td className="text-center tabular-nums">{r.draws}</td>
              <td className="text-center tabular-nums">{r.losses}</td>
              <td className="text-center tabular-nums">{r.pointDiff > 0 ? "+" : ""}{r.pointDiff}</td>
              <td className="text-center font-semibold tabular-nums">{r.leaguePoints}</td>
              {/* my-matches-link: ดูแมตช์ cell (pair only) — ลบ <td> นี้คู่กับ <th> ด้านบนเพื่อถอด entry point */}
              {unit === "pair" && (
                <td className="text-center">
                  <PairScheduleLink
                    pairId={c?.id}
                    label="ดูแมตช์"
                    className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground align-middle"
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                  </PairScheduleLink>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
    </>
  );
}
