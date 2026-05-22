"use client";

import { useMemo } from "react";
import { Bar, BarChart, Cell, LabelList } from "recharts";
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
import { OrientableBarAxes, orientableBarLayout } from "@/components/tournament/charts/orientable-bar";
import type { Match, Pair, Team } from "@/lib/types";

type TeamSummaryProps = {
  teams: Team[];
  matches: Match[];
  pairs?: Pair[];
  matchUnit: "team" | "pair";
  size?: "default" | "tv";
  orientation?: "vertical" | "horizontal";
  fillParent?: boolean;
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

  const pairById = new Map(pairList.map((p) => [p.id, p]));
  const ptsPerTeam = new Map<string, number>();
  for (const row of rows) {
    const pair = pairById.get(row.competitorId);
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

export function TeamSummary({ teams, matches, pairs, matchUnit, size = "default", orientation = "vertical", fillParent = false }: TeamSummaryProps) {
  const entries = useMemo(
    () => buildTeamSummary(teams, matches, pairs, matchUnit),
    [teams, matches, pairs, matchUnit]
  );
  const isTv = size === "tv";
  const barLayout = orientableBarLayout(orientation);

  const completedMatches = matches.filter((m) => m.status === "completed").length;

  if (completedMatches === 0 || teams.length < 2) return null;

  const chartData = entries.map((e) => ({
    name: e.name,
    pts: e.pts,
    fill: e.color ?? "#94a3b8",
  }));

  // ~32px per row + padding; min 140 so very small lists still look balanced
  const rowH = isTv ? 56 : 36;
  const chartHeight = Math.max(isTv ? 200 : 140, entries.length * rowH + 24);
  const yAxisWidth = isTv ? 140 : 88;
  const tickFontSize = isTv ? 20 : 12;
  const labelFontSize = isTv ? 24 : 12;

  return (
    <Card className={fillParent ? "h-full flex flex-col" : undefined}>
      <CardHeader className="pb-2 shrink-0">
        <CardTitle className={isTv ? "text-2xl lg:text-3xl 2xl:text-4xl" : "text-sm"}>คะแนนสะสมแต่ละทีม</CardTitle>
        {!isTv && <CardDescription className="text-xs">เปรียบเทียบคะแนนระหว่างทีม</CardDescription>}
      </CardHeader>
      <CardContent className={fillParent ? "px-2 pb-3 flex-1 min-h-0 flex flex-col" : "px-2 pb-3"}>
        <ChartContainer
          config={chartConfig}
          className={fillParent ? "w-full flex-1 min-h-0 aspect-auto" : "w-full"}
          style={fillParent ? { aspectRatio: "auto" } : { height: chartHeight }}
        >
          <BarChart
            accessibilityLayer
            data={chartData}
            {...(barLayout.layout ? { layout: barLayout.layout } : {})}
            margin={orientation === "horizontal"
              ? { top: 4, right: 24, bottom: 4, left: 8 }
              : { top: 24, right: 24, bottom: 4, left: 8 }}
          >
            <OrientableBarAxes
              orientation={orientation}
              dataKey="name"
              categoryYWidth={yAxisWidth}
              tickFontSize={tickFontSize}
              tickFontWeight={isTv ? 600 : 400}
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
                position={barLayout.labelPosition}
                offset={8}
                className="fill-foreground"
                fontSize={labelFontSize}
                fontWeight={isTv ? 800 : 600}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
