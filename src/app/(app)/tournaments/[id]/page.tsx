import { notFound } from "next/navigation";
import { format } from "date-fns";
import { th } from "date-fns/locale";
import { Trophy, MapPin, CalendarDays, Users, Swords, GitBranch } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { TeamManager } from "@/components/tournament/team-manager";
import { GroupStage } from "@/components/tournament/group-stage";
import { PairStage } from "@/components/tournament/pair-stage";
import { KnockoutStage } from "@/components/tournament/knockout-stage";
import { TournamentStatusControl } from "@/components/tournament/tournament-status-control";
import { ExportButtons } from "@/components/tournament/export-buttons";
import { ShareControls } from "@/components/tournament/share-controls";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import type { Tournament, TeamWithPlayers, GroupWithTeams, Team, PairWithPlayers, Match } from "@/lib/types";

export const dynamic = "force-dynamic";

const statusLabel: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "แบบร่าง", variant: "outline" },
  registering: { label: "เปิดรับสมัคร", variant: "secondary" },
  ongoing: { label: "กำลังแข่ง", variant: "default" },
  completed: { label: "จบแล้ว", variant: "destructive" },
};

const formatLabel: Record<string, string> = {
  group_only: "แบ่งกลุ่ม",
  group_knockout: "แบ่งกลุ่ม + Knockout",
  knockout_only: "Knockout",
};

export default async function TournamentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createAdminClient();
  const session = await getSession();

  const { data: tournament } = await sb
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .single();

  if (!tournament) notFound();
  const t = tournament as Tournament;

  // Fetch teams first so we can filter pairs by team_id
  const teamsRes = await sb.from("teams").select("*, players:team_players(*)").eq("tournament_id", id).order("created_at");
  const teamIdList = (teamsRes.data ?? []).map((t) => t.id);

  const [groupsRes, pairsRes, matchesRes] = await Promise.all([
    sb.from("groups").select("*, group_teams(*, team:teams(*)), matches(*)").eq("tournament_id", id).order("name"),
    teamIdList.length
      ? sb.from("pairs").select("*, player1:team_players!player_id_1(*), player2:team_players!player_id_2(*)").in("team_id", teamIdList).order("created_at")
      : Promise.resolve({ data: [] }),
    sb.from("matches").select("*").eq("tournament_id", id).order("match_number"),
  ]);

  const teams: TeamWithPlayers[] = (teamsRes.data ?? []) as TeamWithPlayers[];
  const groups: GroupWithTeams[] = (groupsRes.data ?? []) as GroupWithTeams[];
  const allMatches: Match[] = (matchesRes.data ?? []) as Match[];

  const pairs: PairWithPlayers[] = (pairsRes.data ?? []) as unknown as PairWithPlayers[];

  const flatTeams: Team[] = teams.map(({ players: _p, ...x }) => x as Team);
  const isOwner = session?.profileId === t.owner_id;
  const s = statusLabel[t.status];
  const showGroupStage = t.match_unit === "team" && (t.format === "group_only" || t.format === "group_knockout");
  const showPairStage = t.match_unit === "pair";
  const showKnockoutStage = t.format === "group_knockout" || t.format === "knockout_only";
  const knockoutMatches = allMatches.filter((m) => m.round_type === "knockout");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return (
    <TournamentLiveWrapper tournamentId={t.id} isOngoing={t.status === "ongoing"}>
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-6 w-6 shrink-0" />
            <h1 className="text-2xl font-bold">{t.name}</h1>
          </div>
          <Badge variant={s.variant}>{s.label}</Badge>
        </div>
      </div>

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

      {isOwner && (
        <>
          <TournamentStatusControl tournamentId={t.id} currentStatus={t.status} />
          <ShareControls tournamentId={t.id} shareToken={t.share_token} appUrl={appUrl} />
        </>
      )}

      <ExportButtons
        tournamentName={t.name}
        matches={allMatches}
        teams={teams}
        pairs={pairs}
        matchUnit={t.match_unit}
        isOwner={isOwner}
      />

      {t.notes && (
        <Card>
          <CardContent className="pt-4 text-sm whitespace-pre-wrap">{t.notes}</CardContent>
        </Card>
      )}

      <Separator />

      <TeamManager
        tournamentId={t.id}
        teams={teams}
        isOwner={isOwner}
        teamCount={t.team_count}
      />

      {showGroupStage && (
        <>
          <Separator />
          <GroupStage tournamentId={t.id} groups={groups} teams={flatTeams} isOwner={isOwner} />
        </>
      )}

      {showPairStage && (
        <>
          <Separator />
          <PairStage
            tournamentId={t.id}
            teams={teams}
            pairs={pairs}
            matches={allMatches.filter((m) => m.pair_a_id)}
            isOwner={isOwner}
          />
        </>
      )}

      {showKnockoutStage && (
        <>
          <Separator />
          <KnockoutStage
            tournamentId={t.id}
            matches={knockoutMatches}
            teams={flatTeams}
            pairs={t.match_unit === "pair" ? pairs : undefined}
            matchUnit={t.match_unit}
            advanceCount={t.advance_count ?? 2}
            isOwner={isOwner}
          />
        </>
      )}
    </div>
    </TournamentLiveWrapper>
  );
}
