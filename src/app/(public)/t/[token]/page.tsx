import { notFound } from "next/navigation";
import { Info } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { GroupStage } from "@/components/tournament/group-stage";
import { PairStage } from "@/components/tournament/pair-stage";
import { KnockoutStage } from "@/components/tournament/knockout-stage";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import { PublicHero } from "@/components/tournament/public/public-hero";
import { PublicOverview } from "@/components/tournament/public/public-overview";
import { PublicTournamentShell } from "@/components/tournament/public/public-tournament-shell";
import { TournamentDashboardLazy } from "@/components/tournament/tournament-dashboard-lazy";
import { MatchQueue } from "@/components/tournament/match-queue";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { parseSettings } from "@/lib/tournament/settings";
import { parseTournamentThresholds } from "@/lib/tournament/divisions";
import type {
  Tournament,
  TeamWithPlayers,
  GroupWithTeams,
  Team,
  PairWithPlayers,
  Match,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PublicTournamentPage({
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

  // teams, groups, matches, and pairs are all independent — fetch in a single wave.
  // Pairs uses an inner join on teams to scope by tournament_id without first
  // awaiting the teams list (cast required because the join column shape isn't
  // part of the generated PairWithPlayers type).
  const [teamsRes, groupsRes, matchesRes, pairsRes] = await Promise.all([
    sb
      .from("teams")
      .select("*, players:team_players(*)")
      .eq("tournament_id", t.id)
      .order("created_at"),
    sb
      .from("groups")
      .select("*, group_teams(*, team:teams(*)), matches(*)")
      .eq("tournament_id", t.id)
      .order("name"),
    sb
      .from("matches")
      .select("*")
      .eq("tournament_id", t.id)
      .order("round_type", { ascending: true })
      .order("match_number"),
    sb
      .from("pairs")
      .select(
        "*, player1:team_players!player_id_1(*), player2:team_players!player_id_2(*), team:teams!inner(tournament_id)"
      )
      .eq("team.tournament_id", t.id)
      .order("created_at"),
  ]);

  const teams: TeamWithPlayers[] = (teamsRes.data ?? []) as TeamWithPlayers[];
  const groups: GroupWithTeams[] = (groupsRes.data ?? []) as GroupWithTeams[];
  const allMatches: Match[] = (matchesRes.data ?? []) as Match[];
  const pairs: PairWithPlayers[] = (pairsRes.data ?? []) as unknown as PairWithPlayers[];
  const flatTeams: Team[] = teams.map(({ players: _p, ...x }) => x as Team);

  const settings = parseSettings(t.settings);
  const showGroupStage =
    t.match_unit === "team" &&
    (t.format === "group_only" || t.format === "group_knockout");
  const showPairStage = t.match_unit === "pair";
  const showKnockoutStage =
    t.format === "group_knockout" || t.format === "knockout_only";
  const showQueueStage = allMatches.length > 0;
  const competitorById = buildCompetitorMap(t.match_unit, flatTeams, pairs);
  const knockoutMatches = allMatches.filter((m) => m.round_type === "knockout");

  return (
    <TournamentLiveWrapper tournamentId={t.id} isOngoing={t.status === "ongoing"} realtimeEnabled={settings.realtime_enabled}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8">
        <PublicHero
          tournament={t}
          token={token}
          teams={teams}
          allMatches={allMatches}
          showBracketLink={knockoutMatches.length > 0}
        />

        {t.notes && (
          <div className="flex gap-3 rounded-r-lg border-l-4 border-amber-400 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3 text-sm whitespace-pre-wrap">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>{t.notes}</div>
          </div>
        )}

        <PublicTournamentShell
          showGroups={showGroupStage}
          showPairs={showPairStage}
          showKnockout={showKnockoutStage}
          showQueue={showQueueStage}
          dashboard={
            <TournamentDashboardLazy
              tournament={t}
              teams={teams}
              pairs={pairs}
              matches={allMatches}
            />
          }
          overview={
            <PublicOverview
              tournament={t}
              teams={teams}
              flatTeams={flatTeams}
              pairs={pairs}
              allMatches={allMatches}
            />
          }
          groups={
            showGroupStage ? (
              <GroupStage
                tournamentId={t.id}
                groups={groups}
                teams={flatTeams}
                isOwner={false}
                matchRowSize="comfortable"
                showColorSummary={settings.color_summary}
              />
            ) : undefined
          }
          pairs={
            showPairStage ? (
              <PairStage
                tournamentId={t.id}
                teams={teams}
                pairs={pairs}
                matches={allMatches.filter((m) => m.pair_a_id)}
                pairDivisionThresholds={parseTournamentThresholds(t.pair_division_thresholds)}
                isOwner={false}
                matchRowSize="comfortable"
              />
            ) : undefined
          }
          knockout={
            showKnockoutStage ? (
              <KnockoutStage
                tournamentId={t.id}
                matches={knockoutMatches}
                teams={flatTeams}
                pairs={t.match_unit === "pair" ? pairs : undefined}
                matchUnit={t.match_unit}
                advanceCount={t.advance_count ?? 2}
                isOwner={false}
                format={t.format}
                matchRowSize="comfortable"
              />
            ) : undefined
          }
          queue={
            showQueueStage ? (
              <MatchQueue
                matches={allMatches}
                competitorById={competitorById}
                tournamentId={t.id}
                unit={t.match_unit}
                canEdit={false}
                courts={t.courts ?? []}
                requireCourtToStart={settings.require_court_to_start}
                courtStrict={settings.court_strict}
              />
            ) : undefined
          }
        />
      </div>
    </TournamentLiveWrapper>
  );
}
