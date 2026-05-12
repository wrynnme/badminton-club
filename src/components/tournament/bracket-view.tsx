import { BracketMatchCard } from "@/components/tournament/bracket-match-card";
import { CONNECTOR_W } from "@/lib/tournament/bracket-visual";
import type { VisualRound } from "@/lib/tournament/bracket-visual";
import type { Competitor } from "@/lib/tournament/competitor";
import type { MatchUnit } from "@/lib/types";

export function BracketView({
  rounds,
  competitorById,
  unit,
}: {
  rounds: VisualRound[];
  competitorById: Map<string, Competitor>;
  unit: MatchUnit;
}) {
  if (!rounds.length) return null;

  const get = (id: string | null | undefined) =>
    id ? (competitorById.get(id) ?? null) : null;

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex items-start" style={{ minWidth: "max-content" }}>
        {rounds.map((round, rIdx) => {
          const isFirst = rIdx === 0;
          const isLast = rIdx === rounds.length - 1;

          return (
            <div key={round.roundNumber} className="flex flex-col">
              {/* Round label */}
              <div
                className="text-xs font-medium text-muted-foreground text-center mb-3"
                style={{ width: 192 + (isFirst ? 0 : CONNECTOR_W) + (isLast ? 0 : CONNECTOR_W) }}
              >
                {round.label}
              </div>

              {/* Slots */}
              {round.matches.map((match, sIdx) => {
                const isEven = sIdx % 2 === 0;
                const hasVertical = !isLast && isEven && round.matches.length > 1;

                const aId = unit === "pair" ? match?.pair_a_id : match?.team_a_id;
                const bId = unit === "pair" ? match?.pair_b_id : match?.team_b_id;

                return (
                  <div
                    key={sIdx}
                    className="relative flex items-center"
                    style={{ height: round.slotHeight }}
                  >
                    {/* Left connector (not for first round) */}
                    {!isFirst && (
                      <div
                        className="border-t border-muted-foreground/25"
                        style={{ width: CONNECTOR_W, flexShrink: 0 }}
                      />
                    )}

                    {/* Match card */}
                    <BracketMatchCard
                      match={match}
                      competitorA={get(aId)}
                      competitorB={get(bId)}
                    />

                    {/* Right connector */}
                    {!isLast && (
                      <div
                        className="border-t border-muted-foreground/25"
                        style={{ width: CONNECTOR_W, flexShrink: 0 }}
                      />
                    )}

                    {/* Vertical connector joining this slot to the next (even slots only) */}
                    {hasVertical && (
                      <div
                        className="absolute bg-muted-foreground/25"
                        style={{
                          right: 0,
                          top: "50%",
                          width: 1,
                          height: round.slotHeight,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
