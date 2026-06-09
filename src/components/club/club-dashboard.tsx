"use client";

import { useMemo, type ReactNode } from "react";
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
import {
  computeClubCostSummary,
  computePlayerUsage,
  playerSessionTotal,
  formatHours,
} from "@/lib/club/cost-summary";
import { truncate } from "@/lib/utils";
import type { Club, ClubPlayer, ClubMatch, Level } from "@/lib/types";
import type { ClubExpense } from "@/lib/actions/clubs";

const chartConfig = {
  games: { label: "เกม", color: "var(--chart-1)" },
  matches: { label: "แมตช์", color: "var(--chart-2)" },
} satisfies ChartConfig;

type Props = {
  club: Club;
  players: ClubPlayer[];
  matches: ClubMatch[];
  levels: Level[];
  expenses: ClubExpense[];
  /** Session grand total from computeClubCostSummary (the canonical money path). */
  costTotal: number;
  maxPlayers: number;
};

export function ClubDashboard({ club, players, matches, levels, expenses, costTotal, maxPlayers }: Props) {
  const d = useMemo(() => computeClubDashboard(players, matches), [players, matches]);

  // Per-player cost (court/shuttle/total) + usage (hours/shuttles) via the SAME
  // shared helpers the cost-breakdown tab + CSV use, so every surface reconciles.
  const cost = useMemo(
    () => computeClubCostSummary({ club, players, matches, expenses }),
    [club, players, matches, expenses],
  );
  const usage = useMemo(
    () => computePlayerUsage({ club, players, matches }),
    [club, players, matches],
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

  // Top 10 players by completed-match appearances (desc). Key each bar by player
  // id (unique) so two players with the same — or same 14-char prefix — name don't
  // collapse into one category; the y-axis tick formatter truncates for display.
  const gamesChartData = useMemo(() => {
    return [...d.gamesByPlayer.entries()]
      .map(([id, games]) => ({ id, games }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 10);
  }, [d.gamesByPlayer]);

  const courtChartData = useMemo(
    () => d.courtUsage.map((c) => ({ court: `สนาม ${c.court}`, matches: c.matches })),
    [d.courtUsage],
  );

  // Player table — sorted by games desc then name. Cost columns come from the
  // shared cost summary (court/shuttle per player + expense − discount → total).
  const tableRows = useMemo(() => {
    const courtById = new Map(cost.rows.map((r) => [r.playerId, r.court]));
    const shuttleCostById = new Map(cost.rows.map((r) => [r.playerId, r.shuttle]));
    return players
      .map((p) => {
        const u = usage.get(p.id) ?? { hours: 0, shuttles: 0 };
        const court = courtById.get(p.id) ?? 0;
        const shuttleCost = shuttleCostById.get(p.id) ?? 0;
        const exp = cost.expShareById.get(p.id) ?? 0;
        return {
          id: p.id,
          name: p.display_name,
          level: levelLabelById(p.level_id),
          time: `${(p.start_time ?? club.start_time).slice(0, 5)}–${(p.end_time ?? club.end_time).slice(0, 5)}`,
          hours: u.hours,
          games: d.gamesByPlayer.get(p.id) ?? 0,
          shuttles: u.shuttles,
          court,
          shuttleCost,
          total: playerSessionTotal({ court, shuttle: shuttleCost, expense: exp, discount: p.discount ?? 0 }),
          status: p.status,
        };
      })
      .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name, "th"));
  }, [players, d.gamesByPlayer, levelLabelById, cost, usage, club.start_time, club.end_time]);

  if (players.length === 0 && matches.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          ยังไม่มีข้อมูล — เพิ่มผู้เล่นและเริ่มแมตช์เพื่อดูสถิติ
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="ผู้เล่น"
          value={`${d.activePlayers}/${maxPlayers}`}
          sub={d.reservePlayers > 0 ? `+${d.reservePlayers} สำรอง` : "ตัวจริง"}
        />
        <StatCard
          icon={<Swords className="h-4 w-4" />}
          label="แมตช์จบแล้ว"
          value={d.completedMatches}
          sub={`กำลังแข่ง ${d.inProgressMatches} · รอ ${d.pendingMatches}`}
        />
        <StatCard
          icon={<CircleDot className="h-4 w-4" />}
          label="ลูกขนไก่"
          value={d.totalShuttles}
          sub="ใช้ไปทั้งหมด"
        />
        <StatCard
          icon={<Wallet className="h-4 w-4" />}
          label="ค่าใช้จ่ายรวม"
          value={`${costTotal.toLocaleString()} ฿`}
          sub="สนาม + ลูก + อื่นๆ"
        />
        <StatCard
          icon={<Coins className="h-4 w-4" />}
          label="เฉลี่ย/คน"
          value={`${perPlayer.toLocaleString()} ฿`}
          sub={`หาร ${d.totalPlayers} คน`}
        />
      </div>

      {/* ── Charts ── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">เกมต่อผู้เล่น (สูงสุด 10)</CardTitle>
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
              <EmptyBlock />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">การใช้สนาม</CardTitle>
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
              <EmptyBlock />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Player table ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">ผู้เล่นทั้งหมด</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          {tableRows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 text-center">#</TableHead>
                  <TableHead>ชื่อ</TableHead>
                  <TableHead className="w-16 text-center">ระดับ</TableHead>
                  <TableHead className="w-24 text-center whitespace-nowrap">เวลา</TableHead>
                  <TableHead className="w-12 text-center">ชม.</TableHead>
                  <TableHead className="w-12 text-center">เกม</TableHead>
                  <TableHead className="w-16 text-center whitespace-nowrap">ลูกที่ใช้</TableHead>
                  <TableHead className="w-16 text-right whitespace-nowrap">ค่าสนาม</TableHead>
                  <TableHead className="w-16 text-right">ค่าลูก</TableHead>
                  <TableHead className="w-16 text-right">รวม</TableHead>
                  <TableHead className="w-20 text-center">สถานะ</TableHead>
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
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.court.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.shuttleCost.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{r.total.toLocaleString()}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={r.status === "active" ? "secondary" : "outline"} className="text-[10px]">
                        {r.status === "active" ? "ตัวจริง" : "สำรอง"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีผู้เล่น</p>
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

function EmptyBlock() {
  return (
    <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
      ยังไม่มีแมตช์ที่จบ
    </div>
  );
}
