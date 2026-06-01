import { Clock, MapPin, ListOrdered } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";
import { parseDivision, divisionLabelTh, divisionTone } from "@/lib/tournament/divisions";
import { MATCH_STATUS_LABEL_TH, MATCH_STATUS_PILL_CLASS } from "@/lib/tournament/status-display";
import type { Match } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

// ---------------------------------------------------------------------------
// Helpers (extracted from court/[n]/page.tsx — single source of truth)
// ---------------------------------------------------------------------------

/** Format elapsed ms as "Xm Ys" — used for in-progress started_at display. */
export function formatElapsed(startedAt: string | null): string | null {
  if (!startedAt) return null;
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  if (elapsedMs < 0) return null;
  const totalSec = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

/** Format a scheduled_at ISO string as Bangkok HH:mm. */
function formatScheduled(scheduledAt: string | null | undefined): string | null {
  if (!scheduledAt) return null;
  try {
    return new Intl.DateTimeFormat("th-TH", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(scheduledAt));
  } catch {
    return null;
  }
}

function CompetitorBlock({
  competitor,
  isWinner,
  isLoser,
  align = "left",
}: {
  competitor: Competitor | undefined;
  isWinner: boolean;
  isLoser: boolean;
  align?: "left" | "right";
}) {
  const nameColor = isWinner
    ? "text-winner"
    : isLoser
      ? "text-muted-foreground line-through"
      : "text-foreground";

  const alignClass = align === "right" ? "text-right items-end" : "text-left items-start";

  return (
    <div className={`flex-1 min-w-0 flex flex-col gap-0.5 ${alignClass}`}>
      {competitor?.color && (
        <span
          className="inline-block w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: competitor.color }}
        />
      )}
      <span
        className={`text-xl font-bold leading-tight truncate ${nameColor} ${isWinner ? "font-extrabold" : ""}`}
      >
        {competitor?.name ?? "รอคู่แข่ง"}
      </span>
      {competitor?.subtitle && (
        <span className="text-xs text-muted-foreground truncate">{competitor.subtitle}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScheduleMatchCard
// ---------------------------------------------------------------------------

/**
 * Large/normal match card shared by the per-court referee view
 * (`/t/[token]/court/[n]`) and the per-pair schedule view
 * (`/t/[token]/pair/[code]`).
 *
 * The optional `court` / `queuePosition` / `scheduledAt` props are off by
 * default so the court page (which renders the court in its page header and
 * does not surface queue order) keeps its original look. `coloredDivision`
 * defaults false → division badge stays a plain outline like the court page;
 * the schedule view opts into tone colors.
 */
export function ScheduleMatchCard({
  match,
  competitorById,
  unit,
  size = "normal",
  court,
  queuePosition,
  scheduledAt,
  coloredDivision = false,
}: {
  match: Match;
  competitorById: Map<string, Competitor>;
  unit: "team" | "pair";
  size?: "large" | "normal";
  court?: string | null;
  queuePosition?: number | null;
  scheduledAt?: string | null;
  coloredDivision?: boolean;
}) {
  const aId = unit === "team" ? match.team_a_id : match.pair_a_id;
  const bId = unit === "team" ? match.team_b_id : match.pair_b_id;
  const a = aId ? competitorById.get(aId) : undefined;
  const b = bId ? competitorById.get(bId) : undefined;

  const winner = match.status === "completed" ? gameWinner(match.games) : null;
  const totals = match.status === "completed" ? sumGameScores(match.games) : null;
  const gamesA = match.team_a_score ?? 0;
  const gamesB = match.team_b_score ?? 0;

  const elapsed = match.status === "in_progress" ? formatElapsed(match.started_at) : null;
  const scheduled = formatScheduled(scheduledAt);

  const isLarge = size === "large";

  // Canonical status label + pill — shared with match-queue + tv-match-card.
  const statusLabel = MATCH_STATUS_LABEL_TH[match.status];
  const statusCls = MATCH_STATUS_PILL_CLASS[match.status];

  // Division badge — text identical to the old inline `Division {n}`; tone color
  // only when coloredDivision is on (court page passes false → unchanged outline).
  const dn = match.division ? parseDivision(match.division) : null;
  const divLabel = match.division ? (dn ? divisionLabelTh(dn) : `Division ${match.division}`) : null;
  const tone = coloredDivision && dn ? divisionTone(dn) : null;

  const hasMeta = Boolean(court || queuePosition != null || scheduled);

  return (
    <Card className={isLarge ? "border-2" : ""}>
      <CardContent className={isLarge ? "p-4 space-y-3" : "p-3 space-y-2"}>
        {/* Top row: status + match number + elapsed */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className={`px-2 py-0.5 rounded-full border font-medium ${statusCls}`}>
            {statusLabel}
          </span>
          <div className="flex items-center gap-2 text-muted-foreground font-mono">
            {elapsed && (
              <span className="text-success font-semibold">{elapsed}</span>
            )}
            <span>#{match.match_number}</span>
          </div>
        </div>

        {/* Meta row: court / queue / scheduled time (schedule view only) */}
        {hasMeta && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {court && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" />
                สนาม {court}
              </span>
            )}
            {queuePosition != null && (
              <span className="inline-flex items-center gap-1">
                <ListOrdered className="size-3" />
                คิว #{queuePosition}
              </span>
            )}
            {scheduled && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                {scheduled}
              </span>
            )}
          </div>
        )}

        {/* Competitors + score row */}
        <div className="flex items-center gap-3">
          <CompetitorBlock
            competitor={a}
            isWinner={winner === "a"}
            isLoser={winner === "b"}
            align="left"
          />

          {/* Score / VS */}
          <div className="shrink-0 text-center px-1">
            {match.status === "completed" ? (
              <div>
                <div className={`tabular-nums font-bold ${isLarge ? "text-3xl" : "text-2xl"}`}>
                  {gamesA} : {gamesB}
                </div>
                {totals && (
                  <div className="text-muted-foreground tabular-nums text-xs mt-0.5">
                    ({totals.a}–{totals.b})
                  </div>
                )}
              </div>
            ) : (
              <span className={`text-muted-foreground font-bold ${isLarge ? "text-2xl" : "text-xl"}`}>
                VS
              </span>
            )}
          </div>

          <CompetitorBlock
            competitor={b}
            isWinner={winner === "b"}
            isLoser={winner === "a"}
            align="right"
          />
        </div>

        {/* Division badge if present */}
        {divLabel && (
          <div className="flex justify-center">
            <Badge
              variant="outline"
              className={`text-xs ${tone ? `${tone.border} ${tone.bg} ${tone.text}` : ""}`}
            >
              {divLabel}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
