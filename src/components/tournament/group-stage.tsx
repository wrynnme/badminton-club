"use client";

import { useState, useTransition, useMemo } from "react";
import { toast } from "sonner";
import { RefreshCw, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupInput } from "@/components/ui/input-group";
import { MatchList } from "@/components/tournament/match-list";
import { ScoreMatrix } from "@/components/tournament/score-matrix";
import { StandingsTable, StandingsSortKeyNote } from "@/components/tournament/standings-table";
import {
  generateGroupsAction,
  generateGroupMatchesAction,
} from "@/lib/actions/matches";
import { teamToCompetitor } from "@/lib/tournament/competitor";
import { computeStandings } from "@/lib/tournament/scoring";
import type { GroupWithTeams, Team } from "@/lib/types";

// ─── Color summary ────────────────────────────────────────────────────────────

type ColorEntry = { color: string; pts: number; names: string[] };

function buildColorSummary(groups: GroupWithTeams[], teams: Team[]): ColorEntry[] {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const map = new Map<string, ColorEntry>();

  for (const group of groups) {
    const teamIds = group.group_teams.map((gt) => gt.team_id);
    const rows = computeStandings(group.matches, "team", teamIds);
    for (const row of rows) {
      const team = teamById.get(row.competitorId);
      if (!team?.color) continue;
      const entry = map.get(team.color) ?? { color: team.color, pts: 0, names: [] };
      entry.pts += row.leaguePoints;
      if (!entry.names.includes(team.name)) entry.names.push(team.name);
      map.set(team.color, entry);
    }
  }

  return [...map.values()].sort((a, b) => b.pts - a.pts);
}

function ColorSummary({ groups, teams }: { groups: GroupWithTeams[]; teams: Team[] }) {
  const t = useTranslations("tournament");
  const colors = useMemo(() => buildColorSummary(groups, teams), [groups, teams]);
  if (colors.length === 0) return null;

  const maxPts = Math.max(...colors.map((c) => c.pts), 1);

  return (
    <div className="space-y-3">
      {/* Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {colors.map((c) => (
          <Card key={c.color}>
            <CardContent className="px-3 py-2.5 flex items-center gap-2.5">
              <span
                className="w-4 h-4 rounded-full shrink-0 ring-2 ring-offset-2 ring-offset-card"
                style={{ backgroundColor: c.color, ["--tw-ring-color" as string]: c.color }}
              />
              <div className="min-w-0">
                <div className="text-2xl font-bold tabular-nums leading-none">{c.pts}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                  {c.names.join(" · ")}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Bar chart */}
      <Card>
        <CardContent className="px-4 py-3 space-y-2.5">
          <p className="text-xs font-medium text-muted-foreground">{t("groupStage.colorSummaryTitle")}</p>
          {colors.map((c) => (
            <div key={c.color} className="flex items-center gap-2.5">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: c.color }}
              />
              <div className="flex-1 h-5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${(c.pts / maxPts) * 100}%`,
                    backgroundColor: c.color,
                    minWidth: c.pts > 0 ? "0.5rem" : undefined,
                  }}
                />
              </div>
              <span className="text-sm font-semibold tabular-nums w-8 text-right">{c.pts}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function GroupCard({ group, teams, tournamentId, isOwner, matchRowSize }: {
  group: GroupWithTeams;
  teams: Team[];
  tournamentId: string;
  isOwner: boolean;
  matchRowSize?: "compact" | "comfortable";
}) {
  const t = useTranslations("tournament");
  const [showMatches, setShowMatches] = useState(true);
  const [view, setView] = useState<"list" | "matrix">("list");

  const competitors = useMemo(() => {
    const groupTeamIds = group.group_teams.map((gt) => gt.team_id);
    return teams.filter((tt) => groupTeamIds.includes(tt.id)).map(teamToCompetitor);
  }, [group.group_teams, teams]);
  const competitorMap = useMemo(() => new Map(competitors.map((c) => [c.id, c])), [competitors]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{group.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <StandingsTable matches={group.matches} competitors={competitors} unit="team" />

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
                {t("groupStage.matchCount", { count: group.matches.length })}
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
                    {t("groupStage.viewTable")}
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
                <ScoreMatrix
                  matches={group.matches}
                  competitors={competitors}
                  unit="team"
                />
              ) : (
                <MatchList
                  matches={group.matches}
                  competitorById={competitorMap}
                  tournamentId={tournamentId}
                  isOwner={isOwner}
                  unit="team"
                  size={matchRowSize}
                />
              )
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function GroupStage({ tournamentId, groups, teams, isOwner, matchRowSize, showColorSummary = true }: {
  tournamentId: string;
  groups: GroupWithTeams[];
  teams: Team[];
  isOwner: boolean;
  matchRowSize?: "compact" | "comfortable";
  showColorSummary?: boolean;
}) {
  const t = useTranslations("tournament");
  const [groupCount, setGroupCount] = useState(2);
  const [genPending, startGen] = useTransition();
  const [matchPending, startMatch] = useTransition();

  const hasGroups = groups.length > 0;
  const totalMatches = groups.reduce((s, g) => s + g.matches.length, 0);
  const completedMatches = groups.reduce((s, g) => s + g.matches.filter((m) => m.status === "completed").length, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">{t("groupStage.sectionTitle")}</h2>
          {hasGroups && totalMatches > 0 && (
            <Badge variant="outline" className="text-xs">{t("groupStage.progressBadge", { completed: completedMatches, total: totalMatches })}</Badge>
          )}
        </div>
      </div>

      {isOwner && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Field>
                <FieldLabel className="text-xs">{t("groupStage.fieldGroupCount")}</FieldLabel>
                <InputGroup className="w-28">
                  <InputGroupInput
                    type="number" min={1} max={teams.length} value={groupCount}
                    onChange={(e) => setGroupCount(Number(e.target.value))}
                    className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                  <InputGroupAddon align="inline-end"><InputGroupText>{t("groupStage.addonGroup")}</InputGroupText></InputGroupAddon>
                </InputGroup>
              </Field>
              <Button size="sm" variant="outline"
                disabled={genPending}
                onClick={() => startGen(async () => {
                  const res = await generateGroupsAction(tournamentId, groupCount);
                  if (res?.error) toast.error(res.error);
                  else toast.success(res?.knockoutCleared ? t("groupStage.toastGroupsWithReset") : t("groupStage.toastGroups"));
                })}>
                {genPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                {hasGroups ? t("groupStage.btnReshuffle") : t("groupStage.btnGenGroups")}
              </Button>
              {hasGroups && totalMatches === 0 && (
                <Button size="sm"
                  disabled={matchPending}
                  onClick={() => startMatch(async () => {
                    const res = await generateGroupMatchesAction(tournamentId);
                    if (res?.error) toast.error(res.error);
                    else toast.success(res?.knockoutCleared
                      ? t("groupStage.toastMatchesWithReset", { count: res.count ?? 0 })
                      : t("groupStage.toastMatches", { count: res.count ?? 0 }));
                  })}>
                  {matchPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  {t("groupStage.btnGenMatches")}
                </Button>
              )}
            </div>
            {hasGroups && completedMatches > 0 && totalMatches > 0 && (
              <p className="text-xs text-muted-foreground">{t("groupStage.warnReshuffle")}</p>
            )}
          </CardContent>
        </Card>
      )}

      {hasGroups && completedMatches > 0 && showColorSummary && (
        <ColorSummary groups={groups} teams={teams} />
      )}

      {hasGroups ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {groups.map((g) => (
              <GroupCard key={g.id} group={g} teams={teams} tournamentId={tournamentId} isOwner={isOwner} matchRowSize={matchRowSize} />
            ))}
          </div>
          {completedMatches > 0 && <StandingsSortKeyNote />}
        </>
      ) : (
        !isOwner && <p className="text-sm text-muted-foreground">{t("groupStage.emptyNoGroups")}</p>
      )}
    </div>
  );
}
