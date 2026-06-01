"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
} from "recharts";
import {
  Trophy,
  Users,
  Swords,
  ListChecks,
  Activity,
  MapPin,
  CalendarClock,
} from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  computeStandings,
  gameWinner,
  sumGameScores,
  type StandingRow,
} from "@/lib/tournament/scoring";
import {
  buildPairDivisionMap,
  divisionLabelTh,
  parseDivision,
  parseTournamentThresholds,
} from "@/lib/tournament/divisions";
import { OrientableBarAxes, orientableBarLayout } from "@/components/tournament/charts/orientable-bar";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { EntityLink } from "@/components/tournament/stats/entity-link";
import { PairScheduleLink } from "@/components/tournament/pair-schedule-link";
import { TeamSummary } from "@/components/tournament/team-summary";
import { parseSettings } from "@/lib/tournament/settings";
import { truncate } from "@/lib/utils";
import type {
  Match,
  PairWithPlayers,
  TeamWithPlayers,
  Tournament,
} from "@/lib/types";

type Props = {
  tournament: Tournament;
  teams: TeamWithPlayers[];
  pairs: PairWithPlayers[];
  matches: Match[];
};

const accent = "var(--chart-1)";

const chartConfig = {
  pts: { label: "คะแนน", color: "var(--chart-1)" },
  wins: { label: "ฝั่งชนะ", color: "var(--chart-2)" },
  draws: { label: "เสมอ", color: "var(--chart-4)" },
  losses: { label: "ฝั่งแพ้", color: "var(--chart-5)" },
  count: { label: "แมตช์", color: "var(--chart-3)" },
} satisfies ChartConfig;

function EmptyBlock({ label = "ยังไม่มีข้อมูล" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-6 pb-4 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="text-foreground/70">{icon}</span>
          <span className="truncate">{label}</span>
        </div>
        <div className="text-2xl sm:text-3xl font-bold tabular-nums leading-none">
          {value}
        </div>
        {subtitle && (
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div
        className="h-full bg-primary transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

// Thailand-only product — render times in Asia/Bangkok regardless of
// server / client TZ. Using Intl.DateTimeFormat with an explicit timeZone
// makes SSR and CSR output identical (no hydration mismatch).
const BANGKOK_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Bangkok",
});

function formatHHmm(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return BANGKOK_TIME_FMT.format(d);
}

export function TournamentDashboard({ tournament, teams, pairs, matches }: Props) {
  const unit = tournament.match_unit;
  // Memoise: parseSettings runs a zod parse + per-field fallback; cheap but
  // pointless to redo on every render — settings only changes when the
  // tournament row itself changes.
  const settings = useMemo(() => parseSettings(tournament.settings), [tournament.settings]);
  const chartOrientation = settings.chart_orientation;
  const isHorizontal = chartOrientation === "horizontal";
  // Shared axis/layout/label-position lookup reused by all three orientable
  // bar charts on this dashboard (points, W/D/L per division, court usage).
  const pointsAxes = orientableBarLayout(chartOrientation);
  const competitorMap = useMemo(
    () => buildCompetitorMap(unit, teams.map(({ players: _p, ...rest }) => rest), pairs),
    [unit, teams, pairs],
  );

  const playerCount = useMemo(
    () => teams.reduce((acc, t) => acc + (t.players?.length ?? 0), 0),
    [teams],
  );

  // Stable key over the bits of matches we care about — protects downstream
  // useMemos from being invalidated when only the array identity changes
  // (e.g., realtime triggers router.refresh that produces a new array with
  // identical content).
  const matchesKey = useMemo(() => {
    let h = matches.length;
    for (const m of matches) {
      h = ((h << 5) - h + (m.status === "completed" ? 1 : 0)) | 0;
      // Include team_a/b_score (denormalized games-won) so derived memos refresh
      // when a score record is updated even if status string is unchanged.
      h = ((h << 5) - h + (m.team_a_score ?? 0) + (m.team_b_score ?? 0)) | 0;
      // Simple court fingerprint: length of court string (covers assign / clear).
      h = ((h << 5) - h + (m.court?.length ?? 0)) | 0;
      // started_at — seconds since epoch, coerced to i32. Forces invalidation
      // when a match transitions to in_progress (or cooldown timestamp shifts).
      h =
        ((h << 5) -
          h +
          (m.started_at
            ? Math.floor(new Date(m.started_at).getTime() / 1000) | 0
            : 0)) |
        0;
      if (m.games) {
        for (const g of m.games) {
          h = ((h << 5) - h + g.a + g.b) | 0;
        }
      }
    }
    return h;
  }, [matches]);

  const matchTotals = useMemo(() => {
    let completed = 0;
    let inProgress = 0;
    let pending = 0;
    for (const m of matches) {
      if (m.status === "completed") completed++;
      else if (m.status === "in_progress") inProgress++;
      else pending++;
    }
    return { completed, inProgress, pending, total: matches.length };
    // matchesKey already encodes id+status changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchesKey]);

  const progressPct = matchTotals.total === 0
    ? 0
    : Math.round((matchTotals.completed / matchTotals.total) * 100);

  // Standings — use whichever unit the tournament is configured for.
  const standings: StandingRow[] = useMemo(() => {
    const ids = unit === "team"
      ? teams.map((t) => t.id)
      : pairs.map((p) => p.id);
    return computeStandings(matches, unit, ids);
  }, [matches, teams, pairs, unit]);

  const playedStandings = useMemo(
    () => standings.filter((s) => s.played > 0),
    [standings],
  );

  // Division thresholds (declared early so Top performers tabs can use them)
  const divisionThresholds: number[] = useMemo(
    () => parseTournamentThresholds(tournament.pair_division_thresholds),
    [tournament.pair_division_thresholds],
  );

  const hasDivisions = divisionThresholds.length > 0;
  const showTopDivTabs = unit === "pair" && hasDivisions;
  const divisionCountN = divisionThresholds.length + 1;

  // Top performers: division filter state — "all" | "1" | "2" | ...
  const [selectedDiv, setSelectedDiv] = useState<string>("all");

  // Guard against stale division selection — if the tournament mode flips
  // (e.g., pair → team) the division tabs disappear but selectedDiv may
  // still hold "2", leaving filteredPlayedStandings empty. Reset to "all".
  useEffect(() => {
    if (!showTopDivTabs && selectedDiv !== "all") {
      setSelectedDiv("all");
    }
  }, [showTopDivTabs, selectedDiv]);

  // Pair-ID → division map (for "pair" + thresholds mode)
  const pairDivisionMap = useMemo(() => {
    if (unit !== "pair" || !hasDivisions) return new Map<string, number>();
    return buildPairDivisionMap(pairs, divisionThresholds);
  }, [unit, hasDivisions, pairs, divisionThresholds]);

  // Filter playedStandings by selected division (no-op if "all" or no divisions)
  const filteredPlayedStandings = useMemo(() => {
    if (!showTopDivTabs || selectedDiv === "all") return playedStandings;
    const wantDiv = parseInt(selectedDiv, 10);
    if (!Number.isFinite(wantDiv)) return playedStandings;
    return playedStandings.filter(
      (s) => pairDivisionMap.get(s.competitorId) === wantDiv,
    );
  }, [playedStandings, showTopDivTabs, selectedDiv, pairDivisionMap]);

  // Top 5 by total points (StandingRow already sorts by points, then diff)
  const topByPoints = useMemo(
    () => filteredPlayedStandings.slice(0, 5),
    [filteredPlayedStandings],
  );

  // Top 5 by wins
  const topByWins = useMemo(
    () =>
      [...filteredPlayedStandings]
        .sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins;
          if (b.leaguePoints !== a.leaguePoints) return b.leaguePoints - a.leaguePoints;
          return b.pointDiff - a.pointDiff;
        })
        .slice(0, 5),
    [filteredPlayedStandings],
  );

  // Chart A — top 10 entries by points
  const pointsChartData = useMemo(() => {
    return playedStandings.slice(0, 10).map((s) => {
      const c = competitorMap.get(s.competitorId);
      const fill = unit === "team" ? (c?.color ?? accent) : accent;
      return {
        id: s.competitorId,
        name: truncate(c?.name ?? "—", 14),
        fullName: c?.name ?? "—",
        pts: s.leaguePoints,
        fill,
      };
    });
    // matchesKey threads through playedStandings via standings -> computeStandings(matches)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchesKey, playedStandings, competitorMap, unit]);

  // Chart B — Matches played per division, broken down by outcome
  // (pair mode + thresholds set). Each completed match in a division
  // counts EXACTLY ONCE. Since a "match" doesn't have a single perspective,
  // we count from both sides: 1 win + 1 loss for decisive, 2 draws for draw.
  // This means wins == losses (always), and the stack height equals total
  // (matches × 2). Legend labels are renamed to reflect "per-side" semantics.
  const divisionChartData = useMemo(() => {
    if (!hasDivisions) return [];
    type Bucket = { wins: number; draws: number; losses: number };
    const buckets = new Map<number, Bucket>();
    for (const m of matches) {
      if (m.status !== "completed") continue;
      const div = parseDivision(m.division);
      if (div == null) continue;
      const winner = gameWinner(m.games);
      const cur = buckets.get(div) ?? { wins: 0, draws: 0, losses: 0 };
      if (winner === "draw") {
        cur.draws += 2; // both sides drew
      } else {
        cur.wins += 1; // one side won
        cur.losses += 1; // the other side lost
      }
      buckets.set(div, cur);
    }
    const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
    return keys.map((k) => {
      const b = buckets.get(k)!;
      return {
        division: divisionLabelTh(k),
        wins: b.wins,
        draws: b.draws,
        losses: b.losses,
      };
    });
  }, [matchesKey, hasDivisions, divisionThresholds]);

  // Section 4 — court usage + timeline
  const courtUsage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of matches) {
      const c = (m.court ?? "").trim();
      if (!c) continue;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    // Normalise tournament.courts via .trim() to match the trimmed match.court
    // keys above (do NOT lowercase — Thai court names are case-preserving).
    const tournamentCourts = (tournament.courts ?? []).map((c) => c.trim()).filter(Boolean);
    // Use ordered tournament.courts when available, append any unknowns last
    const known = tournamentCourts.filter((c) => counts.has(c));
    const extras = Array.from(counts.keys()).filter((c) => !known.includes(c));
    const order = [...known, ...extras];
    return order.map((name) => ({ name: truncate(name, 12), fullName: name, count: counts.get(name) ?? 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchesKey, tournament.courts]);

  const recentTimeline = useMemo(() => {
    return matches
      .filter((m) => m.status === "completed" && m.started_at)
      .sort((a, b) => {
        const at = new Date(a.started_at ?? 0).getTime();
        const bt = new Date(b.started_at ?? 0).getTime();
        return bt - at;
      })
      .slice(0, 10)
      .map((m) => {
        const aId = unit === "team" ? m.team_a_id : m.pair_a_id;
        const bId = unit === "team" ? m.team_b_id : m.pair_b_id;
        const aName = (aId && competitorMap.get(aId)?.name) || "—";
        const bName = (bId && competitorMap.get(bId)?.name) || "—";
        const totals = sumGameScores(m.games);
        return {
          id: m.id,
          time: formatHHmm(m.started_at),
          matchNumber: m.match_number,
          aName,
          bName,
          // games-won count (e.g. "2:0")
          games: `${m.team_a_score ?? 0}:${m.team_b_score ?? 0}`,
          // sum of points across all games (e.g. "42-30")
          pointTotals: `${totals.a}-${totals.b}`,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchesKey, competitorMap, unit]);

  const pointsChartHeight = Math.max(160, pointsChartData.length * 32 + 24);
  const courtChartHeight = Math.max(140, courtUsage.length * 32 + 24);

  const showBothCharts = hasDivisions && divisionChartData.length > 0;

  const renderRankRow = (s: StandingRow, idx: number, valueLabel: string, value: number) => {
    const c = competitorMap.get(s.competitorId);
    return (
      <li key={s.competitorId} className="flex items-center gap-2 py-1.5">
        <span className="w-5 text-xs tabular-nums text-muted-foreground">{idx + 1}</span>
        {idx === 0 ? (
          <Trophy className="h-3.5 w-3.5 text-brand shrink-0" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {c?.color && unit === "team" && (
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: c.color }}
          />
        )}
        <span className="flex-1 min-w-0 truncate text-sm">
          <EntityLink entityType={unit === "team" ? "team" : "pair"} entityId={c?.id}>
            {c?.name ?? "—"}
          </EntityLink>
        </span>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          ชนะ {s.wins}
        </span>
        <span className="text-sm font-semibold tabular-nums shrink-0">
          {valueLabel} {value}
        </span>
        {/* my-matches-link: ดูตารางแข่ง (pair only) — ลบ block นี้เพื่อถอด entry point */}
        {unit === "pair" && (
          <PairScheduleLink
            pairId={c?.id}
            label="ดูตารางแข่ง"
            className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
          >
            <CalendarClock className="h-3.5 w-3.5" />
          </PairScheduleLink>
        )}
        {/* end my-matches-link */}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      {/* Section 1 — Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard
          icon={<Users className="h-4 w-4" />}
          label={unit === "pair" ? "คู่ทั้งหมด" : "ทีมทั้งหมด"}
          value={unit === "pair" ? pairs.length : teams.length}
          subtitle={
            unit === "pair"
              ? `จาก ${teams.length} ทีม`
              : `${tournament.team_count} ทีมที่ตั้งไว้`
          }
        />
        <SummaryCard
          icon={<Users className="h-4 w-4" />}
          label="ผู้เล่นทั้งหมด"
          value={playerCount}
          subtitle={`เฉลี่ย ${teams.length > 0 ? (playerCount / teams.length).toFixed(1) : "0"} คน/ทีม`}
        />
        <SummaryCard
          icon={<Swords className="h-4 w-4" />}
          label="แมตช์ทั้งหมด"
          value={matchTotals.total}
          subtitle={`จบแล้ว ${matchTotals.completed} / กำลังแข่ง ${matchTotals.inProgress} / รอ ${matchTotals.pending}`}
        />
        <SummaryCard
          icon={<Activity className="h-4 w-4" />}
          label="ความคืบหน้า"
          value={`${progressPct}%`}
          subtitle={
            matchTotals.total > 0
              ? `${matchTotals.completed}/${matchTotals.total} แมตช์`
              : "ยังไม่มีแมตช์"
          }
        >
          <div className="pt-1">
            <ProgressBar pct={progressPct} />
          </div>
        </SummaryCard>
      </div>

      {/* Section 1b — Team score bar */}
      <TeamSummary teams={teams} matches={matches} pairs={pairs} matchUnit={tournament.match_unit} orientation={chartOrientation} />

      {/* Section 2 — Top performers */}
      {showTopDivTabs && (
        <div className="flex justify-end">
          <Tabs value={selectedDiv} onValueChange={(v) => setSelectedDiv(v as string)}>
            <TabsList>
              <TabsTrigger value="all" className="text-xs px-2.5">
                ทั้งหมด
              </TabsTrigger>
              {Array.from({ length: divisionCountN }, (_, i) => i + 1).map((d) => (
                <TabsTrigger key={d} value={String(d)} className="text-xs px-2.5">
                  Div {d}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Trophy className="h-4 w-4 text-brand" />
              อันดับสูงสุด
            </CardTitle>
            <CardDescription className="text-xs">เรียงตามคะแนนรวม</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {topByPoints.length > 0 ? (
              <ol className="divide-y">
                {topByPoints.map((s, i) =>
                  renderRankRow(s, i, "คะแนน", s.leaguePoints),
                )}
              </ol>
            ) : (
              <EmptyBlock />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-primary" />
              ผู้ชนะมากสุด
            </CardTitle>
            <CardDescription className="text-xs">เรียงตามจำนวนแมตช์ที่ชนะ</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {topByWins.length > 0 ? (
              <ol className="divide-y">
                {topByWins.map((s, i) => renderRankRow(s, i, "ครั้ง", s.wins))}
              </ol>
            ) : (
              <EmptyBlock />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Section 3 — Charts */}
      <div className={`grid gap-4 ${showBothCharts ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">
              คะแนนรวมต่อ{unit === "pair" ? "คู่" : "ทีม"}
            </CardTitle>
            <CardDescription className="text-xs">
              สูงสุด 10 อันดับแรก
            </CardDescription>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            {pointsChartData.length > 0 ? (
              <ChartContainer
                config={chartConfig}
                className="w-full"
                style={{ height: pointsChartHeight }}
              >
                <BarChart
                  accessibilityLayer
                  data={pointsChartData}
                  {...(pointsAxes.layout ? { layout: pointsAxes.layout } : {})}
                  margin={{ top: 4, right: 28, bottom: 4, left: 8 }}
                >
                  <OrientableBarAxes
                    orientation={chartOrientation}
                    dataKey="name"
                    categoryYWidth={92}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel />}
                  />
                  <Bar dataKey="pts" radius={4}>
                    {pointsChartData.map((entry) => (
                      <Cell key={entry.id} fill={entry.fill} />
                    ))}
                    <LabelList
                      dataKey="pts"
                      position={pointsAxes.labelPosition}
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

        {showBothCharts && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">
                Win / Draw / Loss แยก Division
              </CardTitle>
              <CardDescription className="text-xs">
                นับเฉพาะแมตช์ที่จบแล้ว
              </CardDescription>
            </CardHeader>
            <CardContent className="px-2 pb-3">
              <ChartContainer
                config={chartConfig}
                className="w-full"
                style={{ height: Math.max(180, divisionChartData.length * 56 + 60) }}
              >
                <BarChart
                  accessibilityLayer
                  data={divisionChartData}
                  {...(pointsAxes.layout ? { layout: pointsAxes.layout } : {})}
                  margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
                >
                  <CartesianGrid vertical={isHorizontal} horizontal={!isHorizontal} strokeDasharray="3 3" />
                  <OrientableBarAxes
                    orientation={chartOrientation}
                    dataKey="division"
                    categoryYWidth={72}
                    valueAxisHidden={false}
                    valueAxisAllowDecimals={false}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="wins" stackId="r" fill="var(--color-wins)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="draws" stackId="r" fill="var(--color-draws)" radius={[0, 0, 0, 0]} />
                  <Bar
                    dataKey="losses"
                    stackId="r"
                    fill="var(--color-losses)"
                    radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Section 4 — Court usage + timeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            การใช้สนาม
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-6">
          {/* Court frequency bar chart */}
          <div>
            <div className="text-sm font-medium mb-2">สนามที่ใช้บ่อยสุด</div>
            {courtUsage.length > 0 ? (
              <ChartContainer
                config={chartConfig}
                className="w-full"
                style={{ height: courtChartHeight }}
              >
                <BarChart
                  accessibilityLayer
                  data={courtUsage}
                  {...(pointsAxes.layout ? { layout: pointsAxes.layout } : {})}
                  margin={{ top: 4, right: 28, bottom: 4, left: 8 }}
                >
                  <OrientableBarAxes
                    orientation={chartOrientation}
                    dataKey="name"
                    categoryYWidth={84}
                    valueAxisAllowDecimals={false}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel />}
                  />
                  <Bar dataKey="count" radius={4} fill="var(--color-count)">
                    <LabelList
                      dataKey="count"
                      position={pointsAxes.labelPosition}
                      offset={8}
                      className="fill-foreground"
                      fontSize={12}
                      fontWeight={600}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyBlock label="ยังไม่มีการจัดสนาม" />
            )}
          </div>

          {/* Recent timeline */}
          <div>
            <div className="text-sm font-medium mb-2">Match timeline (ล่าสุด 10 แมตช์)</div>
            {recentTimeline.length > 0 ? (
              <ul className="divide-y text-sm">
                {recentTimeline.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center gap-3 py-2 text-sm"
                  >
                    <span className="font-mono text-xs text-muted-foreground tabular-nums w-12 shrink-0">
                      {row.time}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums w-10 shrink-0">
                      #{row.matchNumber}
                    </span>
                    <span className="flex-1 min-w-0 truncate">
                      {row.aName} <span className="text-muted-foreground">vs</span>{" "}
                      {row.bName}
                    </span>
                    <span className="flex flex-col items-end shrink-0 leading-tight">
                      <span className="font-semibold tabular-nums">
                        เกม {row.games}
                      </span>
                      <span className="text-[10px] text-muted-foreground tabular-nums font-normal">
                        รวมแต้ม {row.pointTotals}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyBlock label="ยังไม่มีแมตช์ที่จบแล้ว" />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
