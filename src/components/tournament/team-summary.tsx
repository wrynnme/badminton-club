"use client";

import { useMemo } from "react";
import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { computeStandings } from "@/lib/tournament/scoring";
import type { Match, Pair, Team } from "@/lib/types";

type TeamSummaryProps = {
  teams: Team[];
  matches: Match[];
  pairs?: Pair[];
  matchUnit: "team" | "pair";
};

type TeamEntry = { id: string; name: string; color: string | null; pts: number };

function buildTeamSummary(
  teams: Team[],
  matches: Match[],
  pairs: Pair[] | undefined,
  matchUnit: "team" | "pair"
): TeamEntry[] {
  if (matchUnit === "team") {
    const rows = computeStandings(matches, "team", teams.map((t) => t.id));
    return rows.map((row) => {
      const team = teams.find((t) => t.id === row.competitorId);
      return {
        id: row.competitorId,
        name: team?.name ?? "—",
        color: team?.color ?? null,
        pts: row.leaguePoints,
      };
    });
  }

  // Pair mode: aggregate leaguePoints per team across all pairs
  const pairList = pairs ?? [];
  const pairIds = pairList.map((p) => p.id);
  const rows = computeStandings(matches, "pair", pairIds);

  const ptsPerTeam = new Map<string, number>();
  for (const row of rows) {
    const pair = pairList.find((p) => p.id === row.competitorId);
    if (!pair) continue;
    ptsPerTeam.set(pair.team_id, (ptsPerTeam.get(pair.team_id) ?? 0) + row.leaguePoints);
  }

  return teams
    .map((team) => ({
      id: team.id,
      name: team.name,
      color: team.color,
      pts: ptsPerTeam.get(team.id) ?? 0,
    }))
    .sort((a, b) => b.pts - a.pts);
}

const chartConfig = {
  pts: { label: "คะแนน" },
} satisfies ChartConfig;

export function TeamSummary({ teams, matches, pairs, matchUnit }: TeamSummaryProps) {
  const entries = useMemo(
    () => buildTeamSummary(teams, matches, pairs, matchUnit),
    [teams, matches, pairs, matchUnit]
  );

  const completedMatches = matches.filter((m) => m.status === "completed").length;

  if (completedMatches === 0 || teams.length < 2) return null;

  const chartData = entries.map((e) => ({
    name: e.name,
    pts: e.pts,
    fill: e.color ?? "#94a3b8",
  }));

  // ~32px per row + padding; min 140 so very small lists still look balanced
  const chartHeight = Math.max(140, entries.length * 36 + 24);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">คะแนนสะสมแต่ละทีม</CardTitle>
        <CardDescription className="text-xs">เปรียบเทียบคะแนนระหว่างทีม</CardDescription>
      </CardHeader>
      <CardContent className="px-2 pb-3">
        <ChartContainer
          config={chartConfig}
          className="w-full"
          style={{ height: chartHeight }}
        >
          <BarChart
            accessibilityLayer
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              width={88}
              tick={{ fontSize: 12 }}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Bar dataKey="pts" radius={4}>
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
              <LabelList
                dataKey="pts"
                position="right"
                offset={8}
                className="fill-foreground"
                fontSize={12}
                fontWeight={600}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
