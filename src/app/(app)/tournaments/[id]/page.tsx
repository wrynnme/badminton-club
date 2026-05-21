import { notFound } from "next/navigation";
import { format } from "date-fns";
import { th } from "date-fns/locale";
import { Trophy, MapPin, CalendarDays, Users, Swords, GitBranch } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TeamManager } from "@/components/tournament/team-manager";
import { GroupStage } from "@/components/tournament/group-stage";
import { PairStage } from "@/components/tournament/pair-stage";
import { KnockoutStage } from "@/components/tournament/knockout-stage";
import { TournamentStatusControl } from "@/components/tournament/tournament-status-control";
import { ExportButtons } from "@/components/tournament/export-buttons";
import { ShareControls } from "@/components/tournament/share-controls";
import { CoAdminControls } from "@/components/tournament/co-admin-controls";
import { AuditLogPanel } from "@/components/tournament/audit-log-panel";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import { TournamentTabs } from "@/components/tournament/tournament-tabs";
import { TournamentDashboard } from "@/components/tournament/tournament-dashboard";
import { MatchQueue } from "@/components/tournament/match-queue";
import { CourtManager } from "@/components/tournament/court-manager";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { EditTournamentForm } from "@/components/tournament/edit-tournament-form";
import { SettingsManager } from "@/components/tournament/settings-manager";
import type { Tournament, TeamWithPlayers, GroupWithTeams, Team, PairWithPlayers, Match } from "@/lib/types";
import type { TournamentAdmin } from "@/lib/actions/admins";
import { parseSettings } from "@/lib/tournament/settings";
import { parseTournamentThresholds } from "@/lib/tournament/divisions";
import { TOURNAMENT_STATUS_BADGE, TOURNAMENT_STATUS_LABEL } from "@/lib/tournament/status";

export const dynamic = "force-dynamic";

const formatLabel: Record<string, string> = {
  group_only: "แบ่งกลุ่ม",
  group_knockout: "แบ่งกลุ่ม + น็อคเอ้า",
  knockout_only: "น็อคเอ้า",
};

export default async function TournamentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createAdminClient();

  // Fetch session + tournament in parallel — neither depends on the other
  const [session, { data: tournament }] = await Promise.all([
    getSession(),
    sb.from("tournaments").select("*").eq("id", id).single(),
  ]);

  if (!tournament) notFound();
  const t = tournament as Tournament;

  // teams, groups, matches, and pairs are all independent — fetch in a single wave.
  // Pairs uses an inner join on teams to scope by tournament_id without first
  // awaiting the teams list (cast required because the join column shape isn't
  // part of the generated PairWithPlayers type).
  const [teamsRes, groupsRes, matchesRes, pairsRes] = await Promise.all([
    sb.from("teams").select("*, players:team_players(*)").eq("tournament_id", id).order("created_at"),
    sb.from("groups").select("*, group_teams(*, team:teams(*)), matches(*)").eq("tournament_id", id).order("name"),
    sb.from("matches").select("*").eq("tournament_id", id).order("round_type", { ascending: true }).order("match_number"),
    sb
      .from("pairs")
      .select("*, player1:team_players!player_id_1(*), player2:team_players!player_id_2(*), team:teams!inner(tournament_id)")
      .eq("team.tournament_id", id)
      .order("created_at"),
  ]);

  const teams: TeamWithPlayers[] = (teamsRes.data ?? []) as TeamWithPlayers[];
  const groups: GroupWithTeams[] = (groupsRes.data ?? []) as GroupWithTeams[];
  const allMatches: Match[] = (matchesRes.data ?? []) as Match[];
  const pairs: PairWithPlayers[] = (pairsRes.data ?? []) as unknown as PairWithPlayers[];
  const flatTeams: Team[] = teams.map(({ players: _p, ...x }) => x as Team);

  const isOwner = session?.profileId === t.owner_id;

  // co-admin check + coAdmins list: run in parallel when owner (both needed),
  // or run just the check when not owner.
  type CoAdminRow = {
    tournament_id: string;
    user_id: string;
    added_by: string | null;
    added_at: string;
    profile: { line_user_id: string | null; display_name: string | null } | null;
  };

  let isCoAdmin = false;
  let coAdmins: TournamentAdmin[] = [];

  if (isOwner) {
    const { data: rows } = await sb
      .from("tournament_admins")
      .select("tournament_id, user_id, added_by, added_at, profile:profiles!user_id(line_user_id, display_name)")
      .eq("tournament_id", id)
      .order("added_at");
    coAdmins = ((rows ?? []) as unknown as CoAdminRow[]).map((r) => ({
      tournament_id: r.tournament_id,
      user_id: r.user_id,
      line_user_id: r.profile?.line_user_id ?? null,
      display_name: r.profile?.display_name ?? null,
      added_by: r.added_by ?? "",
      added_at: r.added_at,
    }));
  } else if (session?.profileId) {
    const { data: adminRow } = await sb
      .from("tournament_admins")
      .select("user_id")
      .eq("tournament_id", id)
      .eq("user_id", session.profileId)
      .maybeSingle();
    isCoAdmin = !!adminRow;
  }

  const canEdit = isOwner || isCoAdmin;

  const settings = parseSettings(t.settings);
  const showGroups = t.match_unit === "team" && (t.format === "group_only" || t.format === "group_knockout");
  const showPairs = t.match_unit === "pair";
  const showKnockout = t.format === "group_knockout" || t.format === "knockout_only";
  const showQueue = allMatches.length > 0;
  const competitorById = buildCompetitorMap(t.match_unit, flatTeams, pairs);
  const knockoutMatches = allMatches.filter((m) => m.round_type === "knockout");
  const groupMatches = allMatches.filter((m) => m.round_type === "group");
  const groupMatchCompleted = groupMatches.filter((m) => m.status === "completed").length;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return (
    <TournamentLiveWrapper tournamentId={t.id} isOngoing={t.status === "ongoing"} realtimeEnabled={settings.realtime_enabled}>
      <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-6 w-6 shrink-0" />
            <h1 className="text-2xl font-bold">{t.name}</h1>
          </div>
          <Badge variant={TOURNAMENT_STATUS_BADGE[t.status]}>{TOURNAMENT_STATUS_LABEL[t.status]}</Badge>
        </div>

        {/* Info card */}
        <Card>
          <CardContent className="grid sm:grid-cols-2 gap-3 pt-6 text-sm">
            {t.venue && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span>{t.venue}</span>
              </div>
            )}
            {t.start_date && (
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <span>
                  {format(new Date(t.start_date), "d MMM yyyy", { locale: th })}
                  {t.end_date && t.end_date !== t.start_date &&
                    ` – ${format(new Date(t.end_date), "d MMM yyyy", { locale: th })}`}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span>{t.team_count} ทีม</span>
            </div>
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-muted-foreground" />
              <span>{formatLabel[t.format]}</span>
              {t.has_lower_bracket && <Badge variant="outline" className="text-xs">+ สายล่าง</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <Swords className="h-4 w-4 text-muted-foreground" />
              <span>{t.match_unit === "pair" ? "คู่ vs คู่" : "ทีม vs ทีม"}</span>
            </div>
            {t.format === "group_knockout" && (
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <span>ผ่านรอบ {t.advance_count ?? 2} ทีม/กลุ่ม</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tabs */}
        <TournamentTabs
          showGroups={showGroups}
          showPairs={showPairs}
          showKnockout={showKnockout}
          showQueue={showQueue}
          showSettings={canEdit}
          dashboardTab={
            <TournamentDashboard
              tournament={t}
              teams={teams}
              pairs={pairs}
              matches={allMatches}
            />
          }
          teamsTab={
            <TeamManager
              tournamentId={t.id}
              teams={teams}
              isOwner={canEdit}
              teamCount={t.team_count}
            />
          }
          groupsTab={
            <GroupStage tournamentId={t.id} groups={groups} teams={flatTeams} isOwner={canEdit} showColorSummary={settings.color_summary} />
          }
          pairsTab={
            <PairStage
              tournamentId={t.id}
              teams={teams}
              pairs={pairs}
              matches={allMatches.filter((m) => m.pair_a_id)}
              isOwner={canEdit}
              pairDivisionThresholds={parseTournamentThresholds(t.pair_division_thresholds)}
            />
          }
          knockoutTab={
            <KnockoutStage
              tournamentId={t.id}
              matches={knockoutMatches}
              teams={flatTeams}
              pairs={t.match_unit === "pair" ? pairs : undefined}
              matchUnit={t.match_unit}
              advanceCount={t.advance_count ?? 2}
              isOwner={canEdit}
              format={t.format}
              groupCount={groups.length}
              groupMatchTotal={groupMatches.length}
              groupMatchCompleted={groupMatchCompleted}
            />
          }
          queueTab={
            <MatchQueue
              matches={allMatches}
              competitorById={competitorById}
              tournamentId={t.id}
              unit={t.match_unit}
              canEdit={canEdit}
              courts={t.courts ?? []}
              requireCourtToStart={settings.require_court_to_start}
              courtStrict={settings.court_strict}
            />
          }
          settingsTab={
            <div className="space-y-6">
              {canEdit && <TournamentStatusControl tournamentId={t.id} currentStatus={t.status} />}
              {t.notes && (
                <Card>
                  <CardContent className="pt-4 text-sm whitespace-pre-wrap">{t.notes}</CardContent>
                </Card>
              )}
              {settings.export_visible && (
                <ExportButtons
                  tournamentName={t.name}
                  tournamentId={t.id}
                  matches={allMatches}
                  teams={teams}
                  pairs={pairs}
                  matchUnit={t.match_unit}
                  isOwner={canEdit}
                />
              )}
              {canEdit && (
                <>
                  <CourtManager tournamentId={t.id} initialCourts={t.courts ?? []} />
                  <SettingsManager tournamentId={t.id} initialSettings={t.settings} pairDivisionThresholds={parseTournamentThresholds(t.pair_division_thresholds)} />
                  <EditTournamentForm tournament={t} existingTeamCount={teams.length} />
                </>
              )}
              {isOwner && (
                <>
                  <ShareControls tournamentId={t.id} shareToken={t.share_token} appUrl={appUrl} />
                  <CoAdminControls tournamentId={t.id} initialAdmins={coAdmins} />
                </>
              )}
              {canEdit && <AuditLogPanel tournamentId={t.id} />}
            </div>
          }
        />
      </div>
    </TournamentLiveWrapper>
  );
}
