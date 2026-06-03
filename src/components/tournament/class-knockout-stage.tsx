"use client";

import { useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KnockoutStage } from "@/components/tournament/knockout-stage";
import type { Match, PairWithPlayers, Team, TournamentClass } from "@/lib/types";

// Per-class knockout view rendered inside the น็อคเอ้า tab for competition-mode
// (match_unit=pair) tournaments. Class sub-tabs; each renders the existing
// KnockoutStage scoped to one class_id. Class matches carry `division = NULL`,
// so KnockoutStage's single (null-division) bracket path renders them cleanly,
// and `classId` swaps the generate button to the per-class action.
function ClassKnockoutPanel({
  cls,
  knockoutMatches,
  groupMatches,
  pairs,
  teams,
  tournamentId,
  isOwner,
  matchRowSize,
}: {
  cls: TournamentClass;
  knockoutMatches: Match[];
  groupMatches: Match[];
  pairs: PairWithPlayers[];
  teams: Team[];
  tournamentId: string;
  isOwner: boolean;
  matchRowSize?: "compact" | "comfortable";
}) {
  const classKO = useMemo(
    () => knockoutMatches.filter((m) => m.class_id === cls.id),
    [knockoutMatches, cls.id],
  );
  const classGroupMatches = useMemo(
    () => groupMatches.filter((m) => m.class_id === cls.id),
    [groupMatches, cls.id],
  );
  const classPairs = useMemo(
    () => pairs.filter((p) => p.class_id === cls.id),
    [pairs, cls.id],
  );

  const groupCount = useMemo(
    () => new Set(classGroupMatches.map((m) => m.group_id).filter(Boolean)).size,
    [classGroupMatches],
  );
  const groupMatchTotal = classGroupMatches.length;
  const groupMatchCompleted = classGroupMatches.filter((m) => m.status === "completed").length;

  return (
    <KnockoutStage
      tournamentId={tournamentId}
      matches={classKO}
      teams={teams}
      pairs={classPairs}
      matchUnit="pair"
      advanceCount={cls.advance_count}
      isOwner={isOwner}
      format={cls.format}
      groupCount={groupCount}
      groupMatchTotal={groupMatchTotal}
      groupMatchCompleted={groupMatchCompleted}
      matchRowSize={matchRowSize}
      classId={cls.id}
    />
  );
}

export function ClassKnockoutStage({
  tournamentId,
  classes,
  knockoutMatches,
  groupMatches,
  pairs,
  teams,
  isOwner,
  matchRowSize,
}: {
  tournamentId: string;
  classes: TournamentClass[];
  knockoutMatches: Match[];
  groupMatches: Match[];
  pairs: PairWithPlayers[];
  teams: Team[];
  isOwner: boolean;
  matchRowSize?: "compact" | "comfortable";
}) {
  // Only classes whose format includes a knockout stage
  const koClasses = useMemo(
    () => classes.filter((c) => c.format !== "group_only"),
    [classes],
  );

  if (koClasses.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        ยังไม่มี class ที่มีรอบน็อคเอ้า — เพิ่ม class ในแท็บ “ตั้งค่า”
      </p>
    );
  }

  return (
    <Tabs defaultValue={koClasses[0].id} className="space-y-4">
      <TabsList className="w-full flex-wrap h-auto">
        {koClasses.map((c) => (
          <TabsTrigger key={c.id} value={c.id}>
            {c.code}
          </TabsTrigger>
        ))}
      </TabsList>
      {koClasses.map((c) => (
        <TabsContent key={c.id} value={c.id} className="space-y-4">
          <ClassKnockoutPanel
            cls={c}
            knockoutMatches={knockoutMatches}
            groupMatches={groupMatches}
            pairs={pairs}
            teams={teams}
            tournamentId={tournamentId}
            isOwner={isOwner}
            matchRowSize={matchRowSize}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
