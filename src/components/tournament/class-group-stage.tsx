"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw, Loader2, ChevronDown, ChevronUp, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MatchList } from "@/components/tournament/match-list";
import { ScoreMatrix } from "@/components/tournament/score-matrix";
import { StandingsTable, StandingsSortKeyNote } from "@/components/tournament/standings-table";
import {
  generateGroupsForClassAction,
  generatePairMatchesForClassAction,
} from "@/lib/actions/classes";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import type { Competitor } from "@/lib/tournament/competitor";
import type {
  GroupWithTeams,
  PairWithPlayers,
  Team,
  TournamentClass,
  MatchFormat,
} from "@/lib/types";

// One group's card — pair competitors are derived from the group's own matches
// (pair-groups have no `group_teams` rows; standings come from `matches`).
function PairGroupCard({
  group,
  competitorMap,
  tournamentId,
  isOwner,
  matchFormatById,
  matchRowSize,
}: {
  group: GroupWithTeams;
  competitorMap: Map<string, Competitor>;
  tournamentId: string;
  isOwner: boolean;
  matchFormatById?: Map<string, MatchFormat>;
  matchRowSize?: "compact" | "comfortable";
}) {
  const [showMatches, setShowMatches] = useState(true);
  const [view, setView] = useState<"list" | "matrix">("list");

  const competitors = useMemo(() => {
    const ids = [
      ...new Set(
        [
          ...group.matches.map((m) => m.pair_a_id),
          ...group.matches.map((m) => m.pair_b_id),
        ].filter(Boolean) as string[],
      ),
    ];
    return ids.map((id) => competitorMap.get(id)).filter(Boolean) as Competitor[];
  }, [group.matches, competitorMap]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{group.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <StandingsTable matches={group.matches} competitors={competitors} unit="pair" />

        {group.matches.length > 0 && (
          <>
            <Separator />
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowMatches(!showMatches)}>
                {showMatches ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                แมตช์ ({group.matches.length})
              </Button>
              {showMatches && (
                <div className="flex items-center gap-1 ml-auto">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={view === "list"}
                    className={`h-6 px-2 text-xs ${view === "list" ? "text-foreground font-medium" : "text-muted-foreground"}`}
                    onClick={() => setView("list")}>
                    ตาราง
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={view === "matrix"}
                    className={`h-6 px-2 text-xs ${view === "matrix" ? "text-foreground font-medium" : "text-muted-foreground"}`}
                    onClick={() => setView("matrix")}>
                    Matrix
                  </Button>
                </div>
              )}
            </div>
            {showMatches && (
              view === "matrix" ? (
                <ScoreMatrix matches={group.matches} competitors={competitors} unit="pair" />
              ) : (
                <MatchList
                  matches={group.matches}
                  competitorById={competitorMap}
                  tournamentId={tournamentId}
                  isOwner={isOwner}
                  unit="pair"
                  size={matchRowSize}
                  matchFormatById={matchFormatById}
                />
              )
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Per-class group view rendered inside the กลุ่ม tab for competition-mode
// (match_unit=pair) tournaments. Class sub-tabs; each scoped to one class_id.
function ClassGroupPanel({
  cls,
  groups,
  competitorMap,
  tournamentId,
  isOwner,
  matchFormatById,
  matchRowSize,
}: {
  cls: TournamentClass;
  groups: GroupWithTeams[];
  competitorMap: Map<string, Competitor>;
  tournamentId: string;
  isOwner: boolean;
  matchFormatById?: Map<string, MatchFormat>;
  matchRowSize?: "compact" | "comfortable";
}) {
  const [genPending, startGen] = useTransition();
  const [matchPending, startMatch] = useTransition();

  const classGroups = useMemo(
    () => groups.filter((g) => g.class_id === cls.id),
    [groups, cls.id],
  );
  const hasGroups = classGroups.length > 0;
  const totalMatches = classGroups.reduce((s, g) => s + g.matches.length, 0);
  const completedMatches = classGroups.reduce(
    (s, g) => s + g.matches.filter((m) => m.status === "completed").length,
    0,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">รอบแบ่งกลุ่ม</h2>
          <Badge variant="outline" className="text-xs">{cls.code}</Badge>
          {hasGroups && totalMatches > 0 && (
            <Badge variant="outline" className="text-xs">{completedMatches}/{totalMatches} แมตช์</Badge>
          )}
        </div>
        {isOwner && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={hasGroups ? "outline" : "default"}
              disabled={genPending}
              onClick={() => startGen(async () => {
                const res = await generateGroupsForClassAction(cls.id);
                if ("error" in res) toast.error(res.error);
                else toast.success(`แบ่ง ${res.groupCount} กลุ่ม · ${res.matchCount} แมตช์`);
              })}>
              {genPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              {hasGroups ? "สุ่มกลุ่มใหม่" : "แบ่งกลุ่ม"}
            </Button>
            {hasGroups && (
              <Button
                size="sm"
                variant="outline"
                disabled={matchPending}
                onClick={() => startMatch(async () => {
                  const res = await generatePairMatchesForClassAction(cls.id);
                  if ("error" in res) toast.error(res.error);
                  else toast.success(`สร้าง ${res.matchCount} แมตช์`);
                })}>
                {matchPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Swords className="h-3.5 w-3.5 mr-1" />}
                สร้างตารางใหม่
              </Button>
            )}
          </div>
        )}
      </div>

      {hasGroups && completedMatches > 0 && (
        <p className="text-xs text-muted-foreground">
          กด &quot;สุ่มกลุ่มใหม่&quot; จะล้างผลการแข่งขันของ class นี้ทั้งหมด
        </p>
      )}

      {hasGroups ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {classGroups.map((g) => (
              <PairGroupCard
                key={g.id}
                group={g}
                competitorMap={competitorMap}
                tournamentId={tournamentId}
                isOwner={isOwner}
                matchFormatById={matchFormatById}
                matchRowSize={matchRowSize}
              />
            ))}
          </div>
          {completedMatches > 0 && <StandingsSortKeyNote />}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {isOwner ? "กด “แบ่งกลุ่ม” เพื่อจัดคู่เข้ากลุ่มอัตโนมัติ (ห้ามคู่จากทีมเดียวกันอยู่กลุ่มเดียวกัน)" : "ยังไม่มีการแบ่งกลุ่ม"}
        </p>
      )}
    </div>
  );
}

export function ClassGroupStage({
  tournamentId,
  classes,
  groups,
  pairs,
  teams,
  isOwner,
  matchFormatById,
  matchRowSize,
}: {
  tournamentId: string;
  classes: TournamentClass[];
  groups: GroupWithTeams[];
  pairs: PairWithPlayers[];
  teams: Team[];
  isOwner: boolean;
  matchFormatById?: Map<string, MatchFormat>;
  matchRowSize?: "compact" | "comfortable";
}) {
  // Only classes whose format includes a group stage
  const groupClasses = useMemo(
    () => classes.filter((c) => c.format !== "knockout_only"),
    [classes],
  );

  const competitorMap = useMemo(
    () => buildCompetitorMap("pair", teams, pairs),
    [teams, pairs],
  );

  if (groupClasses.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        ยังไม่มี class ที่มีรอบแบ่งกลุ่ม — เพิ่ม class ในแท็บ “ตั้งค่า”
      </p>
    );
  }

  return (
    <Tabs defaultValue={groupClasses[0].id} className="space-y-4">
      <TabsList className="w-full flex-wrap h-auto">
        {groupClasses.map((c) => (
          <TabsTrigger key={c.id} value={c.id}>
            {c.code}
          </TabsTrigger>
        ))}
      </TabsList>
      {groupClasses.map((c) => (
        <TabsContent key={c.id} value={c.id} className="space-y-4">
          <ClassGroupPanel
            cls={c}
            groups={groups}
            competitorMap={competitorMap}
            tournamentId={tournamentId}
            isOwner={isOwner}
            matchFormatById={matchFormatById}
            matchRowSize={matchRowSize}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
