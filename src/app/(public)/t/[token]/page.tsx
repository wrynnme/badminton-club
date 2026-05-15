import { notFound } from "next/navigation";
import { Trophy, MapPin, CalendarDays, Users, Swords, GitBranch, Tv } from "lucide-react";
import { format } from "date-fns";
import { th } from "date-fns/locale";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { GroupStage } from "@/components/tournament/group-stage";
import { PairStage } from "@/components/tournament/pair-stage";
import { KnockoutStage } from "@/components/tournament/knockout-stage";
import { ExportButtons } from "@/components/tournament/export-buttons";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import type { Tournament, TeamWithPlayers, GroupWithTeams, Team, PairWithPlayers, Match } from "@/lib/types";

export const dynamic = "force-dynamic";

const statusLabel: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "แบบร่าง", variant: "outline" },
  registering: { label: "เปิดรับสมัคร", variant: "secondary" },
  ongoing: { label: "กำลังแข่ง", variant: "default" },
  completed: { label: "จบแล้ว", variant: "destructive" },
};

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

  const teamIdList = (teamsRes.data ?? []).map((t) => t.id);

  const [groupsRes, pairsRes, matchesRes] = await Promise.all([
    sb.from("groups").select("*, group_teams(*, team:teams(*)), matches(*)").eq("tournament_id", t.id).order("name"),
    teamIdList.length
      ? sb.from("pairs").select("*, player1:team_players!player_id_1(*), player2:team_players!player_id_2(*)").in("team_id", teamIdList).order("created_at")
      : Promise.resolve({ data: [] }),
    sb.from("matches").select("*").eq("tournament_id", t.id).order("match_number"),
  ]);

  const teams: TeamWithPlayers[] = (teamsRes.data ?? []) as TeamWithPlayers[];
  const groups: GroupWithTeams[] = (groupsRes.data ?? []) as GroupWithTeams[];
  const allMatches: Match[] = (matchesRes.data ?? []) as Match[];
  const pairs: PairWithPlayers[] = (pairsRes.data ?? []) as unknown as PairWithPlayers[];
  const flatTeams: Team[] = teams.map(({ players: _p, ...x }) => x as Team);

  const showGroupStage = t.match_unit === "team" && (t.format === "group_only" || t.format === "group_knockout");
  const showPairStage = t.match_unit === "pair";
  const showKnockoutStage = t.format === "group_knockout" || t.format === "knockout_only";
  const knockoutMatches = allMatches.filter((m) => m.round_type === "knockout");

  const s = statusLabel[t.status];

  return (
    <TournamentLiveWrapper tournamentId={t.id} isOngoing={t.status === "ongoing"}>
      <div className="space-y-5 sm:space-y-6 max-w-4xl mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Trophy className="h-7 w-7 sm:h-8 sm:w-8 shrink-0" />
            <h1 className="text-2xl sm:text-3xl font-bold truncate">{t.name}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={s.variant} className="text-xs sm:text-sm">{s.label}</Badge>
            <Button render={<Link href={`/t/${token}/tv`} />} nativeButton={false} size="sm" variant="outline">
              <Tv className="h-3.5 w-3.5 mr-1" />
              <span className="hidden sm:inline">TV</span>
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-6 text-sm sm:text-base">
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
              <Swords className="h-4 w-4 text-muted-foreground" />
              <span>{t.match_unit === "pair" ? "คู่ vs คู่" : "ทีม vs ทีม"}</span>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-2">
          <ExportButtons
            tournamentName={t.name}
            tournamentId={t.id}
            matches={allMatches}
            teams={teams}
            pairs={pairs}
            matchUnit={t.match_unit}
          />
          {knockoutMatches.length > 0 && (
            <Button render={<Link href={`/tournaments/${t.id}/bracket`} />} nativeButton={false} size="sm" variant="outline">
              <GitBranch className="h-3.5 w-3.5 mr-1" />
              ดูสาย
            </Button>
          )}
        </div>

        {t.notes && (
          <Card>
            <CardContent className="pt-4 text-sm whitespace-pre-wrap">{t.notes}</CardContent>
          </Card>
        )}

        <Separator />

        {showGroupStage && (
          <GroupStage tournamentId={t.id} groups={groups} teams={flatTeams} isOwner={false} matchRowSize="comfortable" />
        )}

        {showPairStage && (
          <>
            <PairStage
              tournamentId={t.id}
              teams={teams}
              pairs={pairs}
              matches={allMatches.filter((m) => m.pair_a_id)}
              pairDivisionThreshold={t.pair_division_threshold}
              isOwner={false}
              matchRowSize="comfortable"
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
              isOwner={false}
              format={t.format}
              matchRowSize="comfortable"
            />
          </>
        )}
      </div>
    </TournamentLiveWrapper>
  );
}
