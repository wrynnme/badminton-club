import { notFound } from "next/navigation";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import { TvAutoRefresh } from "@/components/tournament/tv-auto-refresh";
import { TvMatchCard } from "@/components/tournament/tv-match-card";
import { TvStandingsCarousel, type StandingsPage, type TableRow } from "@/components/tournament/tv-standings-carousel";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { computeStandings, leaguePoints, type StandingRow } from "@/lib/tournament/scoring";
import { computePairDivision } from "@/lib/tournament/divisions";
import { parseSettings } from "@/lib/tournament/settings";
import type { Tournament, Team, PairWithPlayers, Match } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_TEXT: Record<string, string> = {
  draft: "แบบร่าง",
  registering: "เปิดรับสมัคร",
  ongoing: "กำลังแข่ง",
  completed: "จบแล้ว",
};

export default async function TvDisplayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const sb = await createAdminClient();

  const { data: tournament } = await sb
    .from("tournaments")
    .select("*")
    .eq("share_token", token)
    .single();

  if (!tournament) notFound();
  const t = tournament as Tournament;

  // teams and matches are independent — fetch in parallel.
  // pairs needs teamIdList from teams, so it follows in a second wave.
  const [teamsRes, matchesRes] = await Promise.all([
    sb.from("teams").select("*").eq("tournament_id", t.id).order("created_at"),
    sb.from("matches").select("*").eq("tournament_id", t.id).order("match_number"),
  ]);

  const teamIdList = (teamsRes.data ?? []).map((x) => x.id);

  const pairsRes = teamIdList.length
    ? await sb.from("pairs").select("*, player1:team_players!player_id_1(*), player2:team_players!player_id_2(*)").in("team_id", teamIdList).order("created_at")
    : { data: [] };

  const teams: Team[] = (teamsRes.data ?? []) as Team[];
  const pairs: PairWithPlayers[] = (pairsRes.data ?? []) as unknown as PairWithPlayers[];
  const allMatches: Match[] = (matchesRes.data ?? []) as Match[];

  const unit = t.match_unit;
  const competitorMap = buildCompetitorMap(unit, teams, pairs);

  // Limit upcoming to 4 cards so they fit in the left column without scrolling
  const upcoming = allMatches
    .filter((m) => m.status !== "completed")
    .sort((a, b) => {
      // in_progress first, then pending; tiebreak match_number
      if (a.status !== b.status) {
        if (a.status === "in_progress") return -1;
        if (b.status === "in_progress") return 1;
      }
      return a.match_number - b.match_number;
    })
    .slice(0, 4);

  const completed = allMatches
    .filter((m) => m.status === "completed")
    .sort((a, b) => b.match_number - a.match_number)
    .slice(0, 4);

  const competitorIds = unit === "team" ? teams.map((x) => x.id) : pairs.map((p) => p.id);
  const settings = parseSettings(t.settings);

  // --- Build standings pages for the rotating carousel ---
  const standingsPages: StandingsPage[] = [];

  const teamById = new Map(teams.map((tm) => [tm.id, tm]));
  const pairById = new Map(pairs.map((p) => [p.id, p]));

  const rowsFromStandings = (rows: StandingRow[], nameLookup: (id: string) => { name: string; color?: string | null }) =>
    rows
      .filter((s) => s.played > 0)
      .slice(0, 6)
      .map((s) => {
        const meta = nameLookup(s.competitorId);
        return {
          competitorId: s.competitorId,
          name: meta.name,
          color: meta.color,
          played: s.played,
          leaguePoints: s.leaguePoints,
        };
      });

  // Team-aggregated rows used for both the "team totals" table page and the chart page.
  // Computed conditionally per match unit and reused below.
  let teamTotalsRows: TableRow[] = [];

  if (unit === "team") {
    const teamStandings = computeStandings(allMatches, "team", competitorIds);
    teamTotalsRows = rowsFromStandings(teamStandings, (id) => {
      const tm = teamById.get(id);
      return { name: tm?.name ?? "—", color: tm?.color };
    });
    standingsPages.push({
      kind: "table",
      id: "team-total",
      title: "คะแนนรวมทีม",
      rows: teamTotalsRows,
    });
  } else {
    // Pair mode — aggregate per-pair standings into per-team totals
    const pairStandings = computeStandings(allMatches, "pair", competitorIds);

    const teamAgg = new Map<string, StandingRow>();
    for (const row of pairStandings) {
      const pair = pairById.get(row.competitorId);
      if (!pair) continue;
      const tid = pair.team_id;
      const cur = teamAgg.get(tid) ?? {
        competitorId: tid,
        played: 0, wins: 0, draws: 0, losses: 0,
        pointsFor: 0, pointsAgainst: 0,
        leaguePoints: 0, pointDiff: 0,
      };
      cur.played += row.played;
      cur.wins += row.wins;
      cur.draws += row.draws;
      cur.losses += row.losses;
      cur.pointsFor += row.pointsFor;
      cur.pointsAgainst += row.pointsAgainst;
      teamAgg.set(tid, cur);
    }
    for (const row of teamAgg.values()) {
      row.leaguePoints = leaguePoints(row.wins, row.draws);
      row.pointDiff = row.pointsFor - row.pointsAgainst;
    }
    const teamAggSorted = Array.from(teamAgg.values()).sort((a, b) => {
      if (b.leaguePoints !== a.leaguePoints) return b.leaguePoints - a.leaguePoints;
      if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
      return b.pointsFor - a.pointsFor;
    });

    teamTotalsRows = rowsFromStandings(teamAggSorted, (id) => {
      const tm = teamById.get(id);
      return { name: tm?.name ?? "—", color: tm?.color };
    });
    standingsPages.push({
      kind: "table",
      id: "team-total",
      title: "คะแนนรวมทีม",
      rows: teamTotalsRows,
    });

    const thresholds = Array.isArray(t.pair_division_thresholds)
      ? (t.pair_division_thresholds as number[]).filter((n) => typeof n === "number" && !Number.isNaN(n))
      : [];

    const pairNameLookup = (id: string) => {
      const c = competitorMap.get(id);
      const pair = pairById.get(id);
      const tm = pair ? teamById.get(pair.team_id) : undefined;
      return { name: c?.name ?? "—", color: tm?.color };
    };

    if (thresholds.length > 0) {
      const divCount = thresholds.length + 1;
      // Group pair-standings rows by division number (1..N)
      const buckets = new Map<number, StandingRow[]>();
      for (const s of pairStandings) {
        const pair = pairById.get(s.competitorId);
        const lvlRaw = pair?.pair_level;
        const lvl = lvlRaw === null || lvlRaw === undefined
          ? null
          : parseFloat(String(lvlRaw));
        const lvlClean = lvl !== null && Number.isNaN(lvl) ? null : lvl;
        const div = computePairDivision(lvlClean, thresholds) ?? divCount;
        const arr = buckets.get(div) ?? [];
        arr.push(s);
        buckets.set(div, arr);
      }
      for (let d = 1; d <= divCount; d++) {
        standingsPages.push({
          kind: "table",
          id: `div-${d}`,
          title: `Division ${d}`,
          rows: rowsFromStandings(buckets.get(d) ?? [], pairNameLookup),
        });
      }
    } else {
      standingsPages.push({
        kind: "table",
        id: "pair-all",
        title: "อันดับคู่",
        rows: rowsFromStandings(pairStandings, pairNameLookup),
      });
    }
  }

  const allStandingsPages: StandingsPage[] = standingsPages.filter((p) => p.rows.length > 0);

  return (
    <TournamentLiveWrapper tournamentId={t.id} isOngoing={t.status === "ongoing"} realtimeEnabled={settings.realtime_enabled}>
      <TvAutoRefresh intervalMs={60_000} />
      <div className="h-screen w-screen overflow-hidden flex flex-col bg-background text-foreground p-3 lg:p-4">
        {/* Hero — fixed-height header */}
        <header className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b pb-3">
          <div className="flex items-center gap-3 lg:gap-4 min-w-0">
            <Trophy className="h-8 w-8 lg:h-10 lg:w-10 2xl:h-12 2xl:w-12 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-2xl lg:text-4xl xl:text-5xl 2xl:text-6xl font-bold truncate leading-tight">{t.name}</h1>
              {t.venue && (
                <p className="text-sm lg:text-xl 2xl:text-2xl text-muted-foreground truncate leading-tight">{t.venue}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 lg:gap-4">
            <span className="px-3 py-1 lg:px-4 lg:py-1.5 rounded-full border text-sm lg:text-lg 2xl:text-xl font-semibold">
              {STATUS_TEXT[t.status] ?? t.status}
            </span>
            <Link
              href={`/t/${token}`}
              className="text-sm lg:text-base 2xl:text-lg text-muted-foreground hover:text-foreground underline"
            >
              ออก TV
            </Link>
          </div>
        </header>

        {allMatches.length === 0 ? (
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <p className="text-2xl lg:text-4xl 2xl:text-5xl text-muted-foreground">ยังไม่มีการแข่งขัน</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-12 gap-4 lg:gap-6 pt-3 lg:pt-4">
            {/* Upcoming / In progress — left 8/12 */}
            <section className="col-span-8 h-full overflow-hidden flex flex-col">
              <h2 className="shrink-0 text-xl lg:text-2xl 2xl:text-3xl font-bold pb-2 lg:pb-3">กำลังเล่น / ถัดไป</h2>
              <div className="flex-1 min-h-0 overflow-hidden">
                {upcoming.length === 0 ? (
                  <p className="text-lg lg:text-2xl 2xl:text-3xl text-muted-foreground">ไม่มีคิวค้าง</p>
                ) : (
                  <div className="space-y-3">
                    {upcoming.map((m) => (
                      <TvMatchCard key={m.id} match={m} competitorById={competitorMap} unit={unit} />
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Right column — split vertically */}
            <aside className="col-span-4 h-full grid grid-rows-2 gap-4">
              {/* Top — standings carousel */}
              <TvStandingsCarousel pages={allStandingsPages} intervalMs={8000} />

              {/* Bottom — recent */}
              <section className="h-full overflow-hidden flex flex-col">
                <h2 className="shrink-0 text-xl lg:text-2xl 2xl:text-3xl font-bold pb-2">จบล่าสุด</h2>
                <div className="flex-1 min-h-0 overflow-hidden">
                  {completed.length === 0 ? (
                    <p className="text-base lg:text-xl text-muted-foreground">ยังไม่มีผล</p>
                  ) : (
                    <div className="space-y-2 lg:space-y-3">
                      {completed.map((m) => (
                        <TvMatchCard key={m.id} match={m} competitorById={competitorMap} unit={unit} />
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </aside>
          </div>
        )}
      </div>
    </TournamentLiveWrapper>
  );
}
