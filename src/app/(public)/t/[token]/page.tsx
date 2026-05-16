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
import { MatchQueue } from "@/components/tournament/match-queue";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
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

  const teamsRes = await sb
    .from("teams")
    .select("*, players:team_players(*)")
    .eq("tournament_id", t.id)
    .order("created_at");

  const teamIdList = (teamsRes.data ?? []).map((x) => x.id);

  const [groupsRes, pairsRes, matchesRes] = await Promise.all([
    sb
      .from("groups")
      .select("*, group_teams(*, team:teams(*)), matches(*)")
      .eq("tournament_id", t.id)
      .order("name"),
    teamIdList.length
      ? sb
          .from("pairs")
          .select(
            "*, player1:team_players!player_id_1(*), player2:team_players!player_id_2(*)"
          )
          .in("team_id", teamIdList)
          .order("created_at")
      : Promise.resolve({ data: [] }),
    sb
      .from("matches")
      .select("*")
      .eq("tournament_id", t.id)
      .order("queue_position", { ascending: true, nullsFirst: false })
      .order("match_number"),
  ]);

  const teams: TeamWithPlayers[] = (teamsRes.data ?? []) as TeamWithPlayers[];
  const groups: GroupWithTeams[] = (groupsRes.data ?? []) as GroupWithTeams[];
  const allMatches: Match[] = (matchesRes.data ?? []) as Match[];
  const pairs: PairWithPlayers[] = (pairsRes.data ?? []) as unknown as PairWithPlayers[];
  const flatTeams: Team[] = teams.map(({ players: _p, ...x }) => x as Team);

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
    <TournamentLiveWrapper tournamentId={t.id} isOngoing={t.status === "ongoing"}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8">
        <PublicHero
          tournament={t}
          token={token}
          teams={teams}
          pairs={pairs}
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
                pairDivisionThreshold={t.pair_division_threshold}
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
              />
            ) : undefined
          }
        />
      </div>
    </TournamentLiveWrapper>
  );
}
