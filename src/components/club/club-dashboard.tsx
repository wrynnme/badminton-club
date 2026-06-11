"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { Users, Swords, Coins, Wallet, CircleDot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { computeClubDashboard } from "@/lib/club/dashboard";
import { computeClubCostRows, formatHours } from "@/lib/club/cost-summary";
import { truncate } from "@/lib/utils";
import type { Club, ClubPlayer, ClubMatch, Level } from "@/lib/types";
import type { ClubExpense } from "@/lib/actions/club-cost";

type Props = {
  club: Club;
  players: ClubPlayer[];
  matches: ClubMatch[];
  levels: Level[];
  expenses: ClubExpense[];
  /** Session grand total from computeClubCostSummary (the canonical money path). */
  costTotal: number;
  maxPlayers: number;
  /** Public read-only view: hide all money figures (cost cards + cost columns). */
  hideCost?: boolean;
};

export function ClubDashboard({ club, players, matches, levels, expenses, costTotal, maxPlayers, hideCost = false }: Props) {
  const t = useTranslations("club.dashboard");

  const chartConfig = {
    games: { label: t("colGames"), color: "var(--chart-1)" },
    matches: { label: t("statMatches"), color: "var(--chart-2)" },
  } satisfies ChartConfig;

  const d = useMemo(() => computeClubDashboard(players, matches), [players, matches]);

  // Per-player cost + usage rows via the SAME shared builder the cost-breakdown
  // tab + CSV use, so every surface reconciles by construction.
  const cost = useMemo(
    () => computeClubCostRows({ club, players, matches, expenses }),
    [club, players, matches, expenses],
  );

  const nameById = useMemo(
    () => new Map(players.map((p) => [p.id, p.display_name])),
    [players],
  );
  const levelLabelById = useMemo(() => {
    const byId = new Map(levels.map((l) => [l.id, l.label]));
    return (levelId: string | null) => (levelId ? byId.get(levelId) ?? "—" : "—");
  }, [levels]);

  // Average over every player the cost is split across (rows in the cost table),
  // not just ตัวจริง — dividing by activePlayers overstates the per-head figure
  // because reserve players also carry court/shuttle/expense shares.
  const perPlayer = d.totalPlayers > 0 ? Math.round(costTotal / d.totalPlayers) : 0;

  // Top 10 players by completed-match appearances (desc).
  const gamesChartData = useMemo(() => {
    return [...d.gamesByPlayer.entries()]
      .map(([id, games]) => ({ id, games }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 10);
  }, [d.gamesByPlayer]);

  const courtChartData = useMemo(
    () => d.courtUsage.map((c) => ({ court: t("chartCourtPrefix", { name: c.court }), matches: c.matches })),
    [d.courtUsage, t],
  );

  // Player table — sorted by games desc then name.
  const tableRows = useMemo(() => {
    const costById = new Map(cost.rows.map((r) => [r.playerId, r]));
    return players
      .map((p) => {
        const c = costById.get(p.id);
        return {
          id: p.id,
          name: p.display_name,
          level: levelLabelById(p.level_id),
          time: `${(p.start_time ?? club.start_time).slice(0, 5)}–${(p.end_time ?? club.end_time).slice(0, 5)}`,
          hours: c?.hours ?? 0,
          games: c?.games ?? 0,
          shuttles: c?.shuttles ?? 0,
          court: c?.court ?? 0,
          shuttleCost: c?.shuttle ?? 0,
          total: c?.total ?? 0,
          status: p.status,
        };
      })
      .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name, "th"));
  }, [players, d.gamesByPlayer, levelLabelById, cost, club.start_time, club.end_time]);

  if (players.length === 0 && matches.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("empty")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Stat cards ── */}
      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${hideCost ? "lg:grid-cols-3" : "lg:grid-cols-5"}`}>
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label={t("statPlayers")}
          value={`${d.activePlayers}/${maxPlayers}`}
          sub={d.reservePlayers > 0 ? t("statPlayersReserve", { count: d.reservePlayers }) : t("statPlayersActive")}
        />
        <StatCard
          icon={<Swords className="h-4 w-4" />}
          label={t("statMatches")}
          value={d.completedMatches}
          sub={t("statMatchesSub", { inProgress: d.inProgressMatches, pending: d.pendingMatches })}
        />
        <StatCard
          icon={<CircleDot className="h-4 w-4" />}
          label={t("statShuttles")}
          value={d.totalShuttles}
          sub={t("statShuttlesSub")}
        />
        {!hideCost && (
          <StatCard
            icon={<Wallet className="h-4 w-4" />}
            label={t("statCostTotal")}
            value={`${costTotal.toLocaleString()} ฿`}
            sub={t("statCostTotalSub")}
          />
        )}
        {!hideCost && (
          <StatCard
            icon={<Coins className="h-4 w-4" />}
            label={t("statPerPerson")}
            value={`${perPlayer.toLocaleString()} ฿`}
            sub={t("statPerPersonSub", { count: d.totalPlayers })}
          />
        )}
      </div>

      {/* ── Charts ── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("chartGamesTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            {gamesChartData.length > 0 ? (
              <ChartContainer
                config={chartConfig}
                className="w-full"
                style={{ height: Math.max(160, gamesChartData.length * 30 + 24) }}
              >
                <BarChart
                  accessibilityLayer
                  data={gamesChartData}
                  layout="vertical"
                  margin={{ top: 4, right: 28, bottom: 4, left: 8 }}
                >
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" allowDecimals={false} hide />
                  <YAxis
                    type="category"
                    dataKey="id"
                    width={92}
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    tickFormatter={(id: string) => truncate(nameById.get(id) ?? "?", 12)}
                  />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                  <Bar dataKey="games" fill="var(--color-games)" radius={4}>
                    <LabelList
                      dataKey="games"
                      position="right"
                      offset={8}
                      className="fill-foreground"
                      fontSize={12}
                      fontWeight={600}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyBlock label={t("noMatches")} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("chartCourtTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            {courtChartData.length > 0 ? (
              <ChartContainer config={chartConfig} className="w-full" style={{ height: 220 }}>
                <BarChart
                  accessibilityLayer
                  data={courtChartData}
                  margin={{ top: 16, right: 8, bottom: 4, left: 8 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="court" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis type="number" allowDecimals={false} hide />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                  <Bar dataKey="matches" fill="var(--color-matches)" radius={4}>
                    <LabelList
                      dataKey="matches"
                      position="top"
                      offset={6}
                      className="fill-foreground"
                      fontSize={12}
                      fontWeight={600}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyBlock label={t("noMatches")} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Player table ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t("tableTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          {tableRows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 text-center">{t("colNumber")}</TableHead>
                  <TableHead>{t("colName")}</TableHead>
                  <TableHead className="w-16 text-center">{t("colLevel")}</TableHead>
                  <TableHead className="w-24 text-center whitespace-nowrap">{t("colTime")}</TableHead>
                  <TableHead className="w-12 text-center">{t("colHours")}</TableHead>
                  <TableHead className="w-12 text-center">{t("colGames")}</TableHead>
                  <TableHead className="w-16 text-center whitespace-nowrap">{t("colShuttles")}</TableHead>
                  {!hideCost && (
                    <>
                      <TableHead className="w-16 text-right whitespace-nowrap">{t("colCourtFee")}</TableHead>
                      <TableHead className="w-16 text-right">{t("colShuttleFee")}</TableHead>
                      <TableHead className="w-16 text-right">{t("colTotal")}</TableHead>
                    </>
                  )}
                  <TableHead className="w-20 text-center">{t("colStatus")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.map((r, i) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-center text-muted-foreground tabular-nums">{i + 1}</TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-center text-muted-foreground">{r.level}</TableCell>
                    <TableCell className="text-center text-muted-foreground tabular-nums whitespace-nowrap text-xs">{r.time}</TableCell>
                    <TableCell className="text-center tabular-nums text-muted-foreground">{formatHours(r.hours)}</TableCell>
                    <TableCell className="text-center tabular-nums font-semibold">{r.games}</TableCell>
                    <TableCell className="text-center tabular-nums text-muted-foreground">{r.shuttles}</TableCell>
                    {!hideCost && (
                      <>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{r.court.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{r.shuttleCost.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{r.total.toLocaleString()}</TableCell>
                      </>
                    )}
                    <TableCell className="text-center">
                      <Badge variant={r.status === "active" ? "secondary" : "outline"} className="text-[10px]">
                        {r.status === "active" ? t("statusActive") : t("statusReserve")}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("noPlayers")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: string;
}) {
  return (
    <Card className="gap-0 py-3">
      <CardContent className="px-3 space-y-1">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          <span className="text-xs">{label}</span>
        </div>
        <p className="text-xl font-bold leading-tight tabular-nums">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground leading-tight">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function EmptyBlock({ label }: { label: string }) {
  return (
    <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
