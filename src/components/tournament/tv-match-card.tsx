import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";
import type { Match } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: "รอแข่ง", cls: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30" },
  in_progress: { text: "กำลังเล่น", cls: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30" },
  completed: { text: "จบแล้ว", cls: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30" },
};

export function TvMatchCard({
  match,
  competitorById,
  unit,
}: {
  match: Match;
  competitorById: Map<string, Competitor>;
  unit: "team" | "pair";
}) {
  const aId = unit === "team" ? match.team_a_id : match.pair_a_id;
  const bId = unit === "team" ? match.team_b_id : match.pair_b_id;
  const a = aId ? competitorById.get(aId) : undefined;
  const b = bId ? competitorById.get(bId) : undefined;

  const winner = match.status === "completed" ? gameWinner(match.games) : null;
  const totals = match.status === "completed" ? sumGameScores(match.games) : null;
  const gamesA = match.team_a_score ?? 0;
  const gamesB = match.team_b_score ?? 0;

  const status = STATUS_LABEL[match.status] ?? STATUS_LABEL.pending;

  const sideClass = (isWinner: boolean, isLoser: boolean) =>
    isWinner
      ? "text-green-600 dark:text-green-400 font-bold"
      : isLoser
        ? "text-muted-foreground line-through"
        : "font-semibold";

  // Scale down very long names so they still fit / wrap nicely on 4K mounts
  const nameSize = (name?: string) =>
    (name?.length ?? 0) > 30
      ? "text-xl lg:text-2xl 2xl:text-3xl"
      : "text-2xl lg:text-4xl 2xl:text-5xl";

  return (
    <div className="rounded-xl border bg-card p-4 lg:p-6 2xl:p-8 space-y-3">
      <div className="flex items-center justify-between gap-2 text-sm lg:text-base 2xl:text-lg">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full border text-xs lg:text-sm 2xl:text-base font-medium ${status.cls}`}>
            {status.text}
          </span>
          <span className="text-muted-foreground">#{match.match_number}</span>
        </div>
        {match.court && (
          <span className="font-bold text-base lg:text-xl 2xl:text-2xl">Court {match.court}</span>
        )}
      </div>

      <div className="flex items-center gap-3 lg:gap-6">
        <div className={`flex-1 min-w-0 ${sideClass(winner === "a", winner === "b")}`}>
          <div className="flex items-start gap-2">
            {a?.color && (
              <span className="inline-block w-3 h-3 lg:w-4 lg:h-4 2xl:w-5 2xl:h-5 rounded-full shrink-0 mt-2" style={{ backgroundColor: a.color }} />
            )}
            <div className={`${nameSize(a?.name)} break-words leading-tight`}>{a?.name ?? "—"}</div>
          </div>
          {a?.subtitle && (
            <div className="text-base lg:text-2xl 2xl:text-3xl text-muted-foreground font-normal mt-1 break-words">{a.subtitle}</div>
          )}
        </div>

        <div className="text-center shrink-0 px-2 lg:px-4">
          {match.status === "completed" ? (
            <>
              <div className="text-3xl lg:text-5xl 2xl:text-6xl font-bold tabular-nums">
                {gamesA} : {gamesB}
              </div>
              {totals && (
                <div className="text-sm lg:text-lg 2xl:text-xl text-muted-foreground tabular-nums mt-1">
                  ({totals.a}–{totals.b})
                </div>
              )}
            </>
          ) : (
            <div className="text-2xl lg:text-4xl 2xl:text-5xl text-muted-foreground font-bold">VS</div>
          )}
        </div>

        <div className={`flex-1 min-w-0 text-right ${sideClass(winner === "b", winner === "a")}`}>
          <div className="flex items-start justify-end gap-2">
            <div className={`${nameSize(b?.name)} break-words leading-tight`}>{b?.name ?? "—"}</div>
            {b?.color && (
              <span className="inline-block w-3 h-3 lg:w-4 lg:h-4 2xl:w-5 2xl:h-5 rounded-full shrink-0 mt-2" style={{ backgroundColor: b.color }} />
            )}
          </div>
          {b?.subtitle && (
            <div className="text-base lg:text-2xl 2xl:text-3xl text-muted-foreground font-normal mt-1 break-words">{b.subtitle}</div>
          )}
        </div>
      </div>
    </div>
  );
}
