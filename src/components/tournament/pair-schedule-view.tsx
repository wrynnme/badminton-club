"use client";

import { CalendarClock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScheduleMatchCard } from "@/components/tournament/schedule-match-card";
import { MatchHistoryList } from "@/components/tournament/stats/shared/match-history-list";
import { partitionPairMatches } from "@/lib/tournament/pair-schedule";
import { parseDivision, divisionLabelTh, divisionTone } from "@/lib/tournament/divisions";
import type { Match, PairWithPlayers } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

/**
 * Per-pair schedule ("my matches") view — full lifecycle timeline for one pair:
 * กำลังแข่ง (in-progress, court + elapsed) · ถัดไป (pending, court + queue + opponent) ·
 * จบแล้ว (completed score, via the shared MatchHistoryList).
 *
 * Server component; MatchHistoryList is a client child (fine — props are serializable).
 */
export function PairScheduleView({
  pair,
  matches,
  competitorById,
  unit,
}: {
  pair: PairWithPlayers;
  matches: Match[];
  competitorById: Map<string, Competitor>;
  unit: "team" | "pair";
}) {
  const { inProgress, pending, completed } = partitionPairMatches(matches, pair.id);

  const pairName =
    pair.display_pair_name ||
    [pair.player1?.display_name, pair.player2?.display_name].filter(Boolean).join(" / ") ||
    "คู่ไม่มีชื่อ";

  const playerNames = [pair.player1?.display_name, pair.player2?.display_name]
    .filter(Boolean)
    .join(" & ");

  const color = competitorById.get(pair.id)?.color;

  // Infer division from the first of this pair's matches that carries one.
  const firstDivMatch = [...inProgress, ...pending, ...completed].find((m) => m.division != null);
  const divNum = parseDivision(firstDivMatch?.division ?? null);
  const tone = divNum ? divisionTone(divNum) : null;

  const hasAny = inProgress.length > 0 || pending.length > 0 || completed.length > 0;

  return (
    <div className="space-y-5">
      {/* Header card */}
      <Card>
        <CardContent className="space-y-1.5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {color && (
                  <span
                    className="inline-block w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                )}
                <h1 className="text-xl font-bold truncate">{pairName}</h1>
              </div>
              {pair.display_pair_name && playerNames && (
                <p className="text-sm text-muted-foreground mt-0.5">{playerNames}</p>
              )}
            </div>
            {divNum && tone && (
              <Badge variant="outline" className={`${tone.border} ${tone.bg} ${tone.text} shrink-0`}>
                {divisionLabelTh(divNum)}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <CalendarClock className="size-3.5" />
            ตารางแข่งของคู่นี้
          </p>
        </CardContent>
      </Card>

      {/* Empty state */}
      {!hasAny && (
        <div className="rounded-xl border bg-muted/30 py-16 flex flex-col items-center justify-center gap-2 text-center">
          <p className="text-lg font-semibold text-muted-foreground">ยังไม่มีแมตช์ของคู่นี้</p>
          <p className="text-sm text-muted-foreground">รอการจับคู่แข่งขัน</p>
        </div>
      )}

      {/* กำลังแข่ง */}
      {inProgress.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            กำลังแข่ง
          </h2>
          {inProgress.map((m) => (
            <ScheduleMatchCard
              key={m.id}
              match={m}
              competitorById={competitorById}
              unit={unit}
              size="large"
              coloredDivision
              court={m.court}
            />
          ))}
        </section>
      )}

      {/* ถัดไป */}
      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            ถัดไป
          </h2>
          {pending.map((m) => (
            <ScheduleMatchCard
              key={m.id}
              match={m}
              competitorById={competitorById}
              unit={unit}
              coloredDivision
              court={m.court}
              queuePosition={m.queue_position}
              scheduledAt={m.scheduled_at}
            />
          ))}
        </section>
      )}

      {/* จบแล้ว — reuse the shared completed-match table (BYE already excluded by partitionPairMatches) */}
      <MatchHistoryList
        matches={completed}
        isSideA={(m) => m.pair_a_id === pair.id}
        competitorById={competitorById}
        title="จบแล้ว"
        emptyText="ยังไม่มีแมตช์ที่จบ"
      />
    </div>
  );
}
