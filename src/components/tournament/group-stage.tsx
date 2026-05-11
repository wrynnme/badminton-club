"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupInput } from "@/components/ui/input-group";
import { MatchRow } from "@/components/tournament/match-row";
import { StandingsTable } from "@/components/tournament/standings-table";
import {
  generateGroupsAction,
  generateGroupMatchesAction,
} from "@/lib/actions/matches";
import { teamToCompetitor } from "@/lib/tournament/competitor";
import type { GroupWithTeams, Team } from "@/lib/types";

function GroupCard({ group, teams, tournamentId, isOwner }: {
  group: GroupWithTeams;
  teams: Team[];
  tournamentId: string;
  isOwner: boolean;
}) {
  const [showMatches, setShowMatches] = useState(true);

  const groupTeamIds = group.group_teams.map((gt) => gt.team_id);
  const competitors = teams.filter((t) => groupTeamIds.includes(t.id)).map(teamToCompetitor);
  const competitorMap = new Map(competitors.map((c) => [c.id, c]));

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
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowMatches(!showMatches)}>
              {showMatches ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              แมตช์ ({group.matches.length})
            </button>
            {showMatches && (
              <div className="divide-y">
                {group.matches.map((m) => (
                  <MatchRow
                    key={m.id} match={m}
                    competitorById={competitorMap}
                    tournamentId={tournamentId}
                    isOwner={isOwner} unit="team"
                  />
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function GroupStage({ tournamentId, groups, teams, isOwner }: {
  tournamentId: string;
  groups: GroupWithTeams[];
  teams: Team[];
  isOwner: boolean;
}) {
  const [groupCount, setGroupCount] = useState(2);
  const [, startGen] = useTransition();
  const [, startMatch] = useTransition();

  const hasGroups = groups.length > 0;
  const totalMatches = groups.reduce((s, g) => s + g.matches.length, 0);
  const completedMatches = groups.reduce((s, g) => s + g.matches.filter((m) => m.status === "completed").length, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">รอบแบ่งกลุ่ม</h2>
          {hasGroups && totalMatches > 0 && (
            <Badge variant="outline" className="text-xs">{completedMatches}/{totalMatches} แมตช์</Badge>
          )}
        </div>
      </div>

      {isOwner && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Field>
                <FieldLabel className="text-xs">จำนวนกลุ่ม</FieldLabel>
                <InputGroup className="w-28">
                  <InputGroupInput
                    type="number" min={1} max={teams.length} value={groupCount}
                    onChange={(e) => setGroupCount(Number(e.target.value))}
                    className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                  <InputGroupAddon align="inline-end"><InputGroupText>กลุ่ม</InputGroupText></InputGroupAddon>
                </InputGroup>
              </Field>
              <Button size="sm" variant="outline"
                onClick={() => startGen(async () => {
                  const res = await generateGroupsAction(tournamentId, groupCount);
                  if (res?.error) toast.error(res.error);
                  else toast.success("แบ่งกลุ่มแล้ว");
                })}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                {hasGroups ? "สุ่มใหม่" : "แบ่งกลุ่ม"}
              </Button>
              {hasGroups && totalMatches === 0 && (
                <Button size="sm"
                  onClick={() => startMatch(async () => {
                    const res = await generateGroupMatchesAction(tournamentId);
                    if (res?.error) toast.error(res.error);
                    else toast.success(`สร้าง ${res.count} แมตช์แล้ว`);
                  })}>
                  สร้างตารางแข่ง
                </Button>
              )}
            </div>
            {hasGroups && completedMatches > 0 && totalMatches > 0 && (
              <p className="text-xs text-muted-foreground">กด "สุ่มใหม่" จะล้างผลการแข่งขันทั้งหมด</p>
            )}
          </CardContent>
        </Card>
      )}

      {hasGroups ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((g) => (
            <GroupCard key={g.id} group={g} teams={teams} tournamentId={tournamentId} isOwner={isOwner} />
          ))}
        </div>
      ) : (
        !isOwner && <p className="text-sm text-muted-foreground">ยังไม่มีการแบ่งกลุ่ม</p>
      )}
    </div>
  );
}
