import { CARD_H } from "@/lib/tournament/bracket-visual";
import { gameWinner } from "@/lib/tournament/scoring";
import type { Match } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

function Side({
  competitor,
  side,
  match,
}: {
  competitor: Competitor | null;
  side: "a" | "b";
  match: Match;
}) {
  const isCompleted = match.status === "completed";
  const winner = isCompleted && match.games.length ? gameWinner(match.games) : null;
  const isWinner = winner === side;
  const gamesWon = isCompleted
    ? side === "a" ? match.team_a_score ?? 0 : match.team_b_score ?? 0
    : null;

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1.5 ${isWinner ? "bg-primary/10" : ""}`}>
      {competitor?.color && (
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: competitor.color }} />
      )}
      <span className={`text-xs flex-1 truncate min-w-0 ${isWinner ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
        {competitor?.name ?? "TBD"}
      </span>
      {isCompleted && gamesWon != null && (
        <span className={`text-xs tabular-nums shrink-0 ${isWinner ? "font-bold text-foreground" : "text-muted-foreground"}`}>
          {gamesWon}
        </span>
      )}
    </div>
  );
}

export function BracketMatchCard({
  match,
  competitorA,
  competitorB,
}: {
  match: Match | null;
  competitorA: Competitor | null;
  competitorB: Competitor | null;
}) {
  const style = { height: CARD_H, width: 192 };

  if (!match) {
    return (
      <div
        className="rounded border border-dashed border-muted bg-muted/10 flex items-center justify-center text-xs text-muted-foreground"
        style={style}
      >
        —
      </div>
    );
  }

  return (
    <div className="rounded border bg-card shadow-sm overflow-hidden flex flex-col justify-center" style={style}>
      <div className="text-[10px] text-muted-foreground px-2 leading-none pt-1">#{match.match_number}</div>
      <Side competitor={competitorA} side="a" match={match} />
      <div className="border-t border-border/60" />
      <Side competitor={competitorB} side="b" match={match} />
    </div>
  );
}
