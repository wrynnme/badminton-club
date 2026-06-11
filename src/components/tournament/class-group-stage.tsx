"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw, Loader2, ChevronDown, ChevronUp, Swords } from "lucide-react";
import { useTranslations } from "next-intl";
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
import { classToneById } from "@/lib/tournament/class-color";
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
  const t = useTranslations("tournament");
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
                {t("classGroupStage.matchCount", { count: group.matches.length })}
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
                    {t("classGroupStage.viewTable")}
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
  const t = useTranslations("tournament");
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
          <h2 className="font-semibold">{t("classGroupStage.sectionTitle")}</h2>
          <Badge variant="outline" className="text-xs">{cls.code}</Badge>
          {hasGroups && totalMatches > 0 && (
            <Badge variant="outline" className="text-xs">
              {t("classGroupStage.progressBadge", { completed: completedMatches, total: totalMatches })}
            </Badge>
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
                else {
                  if ("knockoutCleared" in res && res.knockoutCleared) {
                    toast.success(t("classGroupStage.toastGroupsReset", { code: cls.code }));
                  } else {
                    toast.success(t("classGroupStage.toastGroups", { code: cls.code }));
                  }
                }
              })}>
              {genPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              {hasGroups ? t("classGroupStage.btnReshuffle") : t("classGroupStage.btnGenGroups")}
            </Button>
            {hasGroups && (
              <Button
                size="sm"
                variant="outline"
                disabled={matchPending}
                onClick={() => startMatch(async () => {
                  const res = await generatePairMatchesForClassAction(cls.id);
                  if ("error" in res) toast.error(res.error);
                  else {
                    if ("knockoutCleared" in res && res.knockoutCleared) {
                      toast.success(t("classGroupStage.toastMatchesReset", { count: res.matchCount, code: cls.code }));
                    } else {
                      toast.success(t("classGroupStage.toastMatches", { count: res.matchCount, code: cls.code }));
                    }
                  }
                })}>
                {matchPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Swords className="h-3.5 w-3.5 mr-1" />}
                {t("classGroupStage.btnGenMatches")}
              </Button>
            )}
          </div>
        )}
      </div>

      {hasGroups && completedMatches > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("classGroupStage.warnReshuffle")}
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
          {isOwner ? t("classGroupStage.emptyOwner") : t("classGroupStage.emptyPublic")}
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
  const t = useTranslations("tournament");
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
        {t("classGroupStage.emptyNoClassGroups")}
      </p>
    );
  }

  return (
    <Tabs defaultValue={groupClasses[0].id} className="space-y-4">
      <TabsList className="w-full flex-wrap h-auto">
        {groupClasses.map((c) => {
          const tone = classToneById(classes, c.id);
          return (
            <TabsTrigger key={c.id} value={c.id} className="gap-1.5">
              <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${tone.bg} border ${tone.border}`} />
              {c.code}
            </TabsTrigger>
          );
        })}
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
