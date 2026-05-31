import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";
import { EntityLink } from "@/components/tournament/stats/entity-link";
import {
  MATCH_STATUS_LABEL_TH,
  MATCH_STATUS_PILL_CLASS,
} from "@/lib/tournament/status-display";
import type { Match } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

export function TvMatchCard({
  match,
  competitorById,
  unit,
  fillHeight = false,
}: {
  match: Match;
  competitorById: Map<string, Competitor>;
  unit: "team" | "pair";
  fillHeight?: boolean;
}) {
  const aId = unit === "team" ? match.team_a_id : match.pair_a_id;
  const bId = unit === "team" ? match.team_b_id : match.pair_b_id;
  const a = aId ? competitorById.get(aId) : undefined;
  const b = bId ? competitorById.get(bId) : undefined;

  const winner = match.status === "completed" ? gameWinner(match.games) : null;
  const totals = match.status === "completed" ? sumGameScores(match.games) : null;
  const gamesA = match.team_a_score ?? 0;
  const gamesB = match.team_b_score ?? 0;

  const statusLabel = MATCH_STATUS_LABEL_TH[match.status] ?? MATCH_STATUS_LABEL_TH.pending;
  const statusCls = MATCH_STATUS_PILL_CLASS[match.status] ?? MATCH_STATUS_PILL_CLASS.pending;
  const isLive = match.status === "in_progress";

  const sideClass = (isWinner: boolean, isLoser: boolean) =>
    isWinner
      ? "text-winner font-bold"
      : isLoser
        ? "text-muted-foreground line-through"
        : "font-semibold";

  // Multi-tier name size: max font when short, shrink progressively to avoid truncation.
  const nameSize = (name?: string) => {
    const len = name?.length ?? 0;
    if (len > 28) return "text-xs lg:text-sm 2xl:text-base";
    if (len > 22) return "text-sm lg:text-base 2xl:text-lg";
    if (len > 16) return "text-base lg:text-lg 2xl:text-xl";
    if (len > 12) return "text-lg lg:text-xl 2xl:text-2xl";
    return "text-lg lg:text-2xl 2xl:text-3xl"; // max
  };

  return (
    <div className={`rounded-xl border bg-card p-2 lg:p-3 2xl:p-4 ${isLive ? "bc-live-card" : ""} ${fillHeight ? "h-full flex flex-col gap-2" : "space-y-2"}`}>
      <div className={`${fillHeight ? "shrink-0" : ""} flex items-center justify-between gap-3 text-sm lg:text-base 2xl:text-lg`}>
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs lg:text-sm 2xl:text-base font-medium shrink-0 ${statusCls}`}>
          {isLive && <span className="bc-live-dot inline-block w-2 h-2 2xl:w-2.5 2xl:h-2.5 rounded-full bg-live" />}
          {statusLabel}
        </span>
        <div className="flex items-center gap-2 min-w-0 ml-auto">
          <span className="text-muted-foreground font-mono shrink-0">#{match.match_number}</span>
          {match.court && (
            <span className="font-bold text-base lg:text-xl 2xl:text-2xl truncate max-w-[200px]">
              Court {match.court}
            </span>
          )}
        </div>
      </div>

      <div className={`${fillHeight ? "flex-1 min-h-0" : ""} flex items-center gap-3 lg:gap-6`}>
        <div className={`flex-1 min-w-0 ${sideClass(winner === "a", winner === "b")}`}>
          <div className="flex items-start gap-2 min-w-0">
            {a?.color && (
              <span className="inline-block w-3 h-3 lg:w-4 lg:h-4 2xl:w-5 2xl:h-5 rounded-full shrink-0 mt-2" style={{ backgroundColor: a.color }} />
            )}
            <EntityLink entityType={unit === "pair" ? "pair" : "team"} entityId={aId}>
              <div className={`${nameSize(a?.name)} whitespace-nowrap truncate leading-tight min-w-0`}>{a?.name ?? "—"}</div>
            </EntityLink>
          </div>
          {a?.subtitle && (
            <div className="text-muted-foreground font-normal mt-1 break-words text-xs lg:text-base 2xl:text-lg">{a.subtitle}</div>
          )}
        </div>

        <div className="text-center shrink-0 px-2 lg:px-4">
          {match.status === "completed" ? (
            <>
              <div className="flex items-center gap-1 leading-none">
                <span className={`font-display font-bold tabular-nums w-14 sm:w-20 text-right leading-none text-5xl sm:text-7xl${isLive ? " text-primary drop-shadow-[0_0_16px_color-mix(in_oklch,var(--color-primary)_60%,transparent)]" : ""}`}>
                  {gamesA}
                </span>
                <span className="text-3xl sm:text-4xl font-bold text-muted-foreground">:</span>
                <span className={`font-display font-bold tabular-nums w-14 sm:w-20 text-left leading-none text-5xl sm:text-7xl${isLive ? " text-primary drop-shadow-[0_0_16px_color-mix(in_oklch,var(--color-primary)_60%,transparent)]" : ""}`}>
                  {gamesB}
                </span>
              </div>
              {totals && (
                <div className="text-muted-foreground tabular-nums mt-1 text-xs lg:text-sm 2xl:text-base">
                  ({totals.a}–{totals.b})
                </div>
              )}
            </>
          ) : (
            <div className="font-heading text-muted-foreground font-bold text-2xl lg:text-4xl 2xl:text-5xl">VS</div>
          )}
        </div>

        <div className={`flex-1 min-w-0 text-right ${sideClass(winner === "b", winner === "a")}`}>
          <div className="flex items-start justify-end gap-2 min-w-0">
            <EntityLink entityType={unit === "pair" ? "pair" : "team"} entityId={bId}>
              <div className={`${nameSize(b?.name)} whitespace-nowrap truncate leading-tight min-w-0`}>{b?.name ?? "—"}</div>
            </EntityLink>
            {b?.color && (
              <span className="inline-block w-3 h-3 lg:w-4 lg:h-4 2xl:w-5 2xl:h-5 rounded-full shrink-0 mt-2" style={{ backgroundColor: b.color }} />
            )}
          </div>
          {b?.subtitle && (
            <div className="text-muted-foreground font-normal mt-1 break-words text-xs lg:text-base 2xl:text-lg">{b.subtitle}</div>
          )}
        </div>
      </div>
    </div>
  );
}
