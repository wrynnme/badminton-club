import { notFound } from "next/navigation";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import { TvAutoRefresh } from "@/components/tournament/tv-auto-refresh";
import { TvFullscreenButton } from "@/components/tournament/tv-fullscreen-button";
import { TeamSummary } from "@/components/tournament/team-summary";
import { TvStandingsCarousel, type StandingsPage, type TableRow } from "@/components/tournament/tv-standings-carousel";
import { TvUpcomingCarousel } from "@/components/tournament/tv-upcoming-carousel";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { computeStandings, type StandingRow } from "@/lib/tournament/scoring";
import { computePairDivision, parsePairLevel, parseTournamentThresholds } from "@/lib/tournament/divisions";
import { parseSettings } from "@/lib/tournament/settings";
import { TOURNAMENT_STATUS_LABEL } from "@/lib/tournament/status";
import type { Tournament, Team, PairWithPlayers, Match } from "@/lib/types";

export const dynamic = "force-dynamic";

// TODO: extract shared public TV header (#review-2026-05-22)

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

  // teams, matches, and pairs are all independent — fetch in a single wave.
  // Pairs uses an inner join on teams to scope by tournament_id without first
  // awaiting the teams list; team_players projection is narrowed to (id,
  // display_name) because TV only renders display names (~50% payload trim on
  // that join). Cast required because the join column shape isn't part of the
  // generated PairWithPlayers type.
  const [teamsRes, matchesRes, pairsRes] = await Promise.all([
    sb.from("teams").select("*").eq("tournament_id", t.id).order("created_at"),
    sb.from("matches").select("*").eq("tournament_id", t.id).order("match_number"),
    sb
      .from("pairs")
      .select("*, player1:team_players!player_id_1(id, display_name), player2:team_players!player_id_2(id, display_name), team:teams!inner(tournament_id)")
      .eq("team.tournament_id", t.id)
      .order("created_at"),
  ]);

  const teams: Team[] = (teamsRes.data ?? []) as Team[];
  const pairs: PairWithPlayers[] = (pairsRes.data ?? []) as unknown as PairWithPlayers[];
  const allMatches: Match[] = (matchesRes.data ?? []) as Match[];

  const unit = t.match_unit;
  const competitorMap = buildCompetitorMap(unit, teams, pairs);

  const settings = parseSettings(t.settings);

  const inProgressMatches = allMatches
    .filter((m) => m.status === "in_progress")
    .sort((a, b) => a.match_number - b.match_number);

  const pendingMatches = allMatches
    .filter((m) => m.status === "pending")
    .sort((a, b) => a.match_number - b.match_number)
    .slice(0, 6);

  const competitorIds = unit === "team" ? teams.map((x) => x.id) : pairs.map((p) => p.id);
  const knockoutCount = allMatches.filter((m) => m.round_type === "knockout").length;
  const STANDINGS_LIMIT = settings.tv_standings_rows;
  // Safety cap: even when user picks 0 ("show all"), never render more than
  // 50 rows on the TV — beyond that the table overflows the fixed-height
  // carousel pane and ruins the layout.
  const effectiveLimit = STANDINGS_LIMIT === 0 ? 50 : STANDINGS_LIMIT;

  // --- Build standings pages for the rotating carousel ---
  const standingsPages: StandingsPage[] = [];

  const teamById = new Map(teams.map((tm) => [tm.id, tm]));
  const pairById = new Map(pairs.map((p) => [p.id, p]));

  const rowsFromStandings = (rows: StandingRow[], nameLookup: (id: string) => { name: string; color?: string | null }) =>
    rows.slice(0, effectiveLimit)
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
    // Pair mode — split per Division (no team-totals page)
    const pairStandings = computeStandings(allMatches, "pair", competitorIds);

    const thresholds = parseTournamentThresholds(t.pair_division_thresholds);

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
        const div = computePairDivision(parsePairLevel(pair?.pair_level), thresholds) ?? divCount;
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
      <TvAutoRefresh intervalMs={settings.tv_refresh_interval_sec * 1000} />
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
              {TOURNAMENT_STATUS_LABEL[t.status] ?? t.status}
            </span>
            {settings.tv_show_fullscreen_button && <TvFullscreenButton />}
            {settings.tv_show_bracket_link && knockoutCount > 0 && (
              <Link
                href={`/t/${token}/bracket`}
                className="text-sm lg:text-base 2xl:text-lg text-muted-foreground hover:text-foreground underline"
              >
                ดูสาย
              </Link>
            )}
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
          // Layout invariant: keep the 3-column grid alive even when sections inside are hidden;
          // empty columns render as placeholder <div>s rather than expanding the others.
          <div className="flex-1 min-h-0 grid grid-cols-12 gap-4 lg:gap-6 pt-3 lg:pt-4">
            {/* Left col-span-4 — "กำลังเล่น / ถัดไป" */}
            {settings.tv_show_upcoming ? (
              <section className="col-span-4 h-full overflow-hidden flex flex-col">
                <TvUpcomingCarousel
                  inProgress={inProgressMatches}
                  pending={pendingMatches}
                  competitorById={competitorMap}
                  unit={unit}
                  intervalMs={settings.tv_upcoming_interval_sec * 1000}
                />
              </section>
            ) : (
              <div className="col-span-4" />
            )}

            {/* Middle col-span-4 — "คะแนนของแต่ละคู่" */}
            {settings.tv_show_standings_carousel ? (
              <aside className="col-span-4 h-full overflow-hidden flex flex-col">
                <TvStandingsCarousel pages={allStandingsPages} intervalMs={settings.tv_carousel_interval_sec * 1000} fontSize={settings.tv_standings_font_size} />
              </aside>
            ) : (
              <div className="col-span-4" />
            )}

            {/* Right col-span-4 — "คะแนนทีม" */}
            {settings.tv_show_team_chart ? (
              <section className="col-span-4 h-full overflow-hidden flex flex-col">
                <TeamSummary teams={teams} matches={allMatches} pairs={pairs} matchUnit={unit} size="tv" orientation="vertical" fillParent />
              </section>
            ) : (
              <div className="col-span-4" />
            )}
          </div>
        )}
      </div>
    </TournamentLiveWrapper>
  );
}
