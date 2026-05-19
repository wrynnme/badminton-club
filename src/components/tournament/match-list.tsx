"use client";

import { MatchRow } from "@/components/tournament/match-row";
import type { Match } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

type Props = {
  matches: Match[];
  competitorById: Map<string, Competitor>;
  tournamentId: string;
  isOwner: boolean;
  unit: "team" | "pair";
  size?: "compact" | "comfortable";
};

// Full DOM (Ctrl+F + print friendly) + `content-visibility: auto` so the
// browser skips paint/layout for rows outside the viewport. Each row gets
// a `contain-intrinsic-size` hint matching the estimated row height to
// prevent scroll-jank when off-screen rows hydrate.
export function MatchList({
  matches,
  competitorById,
  tournamentId,
  isOwner,
  unit,
  size,
}: Props) {
  const intrinsicH = size === "comfortable" ? 76 : 60;
  return (
    <div className="divide-y">
      {matches.map((m) => (
        <div
          key={m.id}
          style={{
            contentVisibility: "auto",
            containIntrinsicSize: `auto ${intrinsicH}px`,
          }}
        >
          <MatchRow
            match={m}
            competitorById={competitorById}
            tournamentId={tournamentId}
            isOwner={isOwner}
            unit={unit}
            size={size}
          />
        </div>
      ))}
    </div>
  );
}
