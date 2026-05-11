import { notFound } from "next/navigation";
import { format } from "date-fns";
import { th } from "date-fns/locale";
import { Trophy, MapPin, CalendarDays, Users, Swords } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { TeamManager } from "@/components/tournament/team-manager";
import { GroupStage } from "@/components/tournament/group-stage";
import { PairStage } from "@/components/tournament/pair-stage";
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

  const [teamsRes, groupsRes, pairsRes, matchesRes] = await Promise.all([
    sb.from("teams").select("*, players:team_players(*)").eq("tournament_id", id).order("created_at"),
    sb.from("groups").select("*, group_teams(*, team:teams(*)), matches(*)").eq("tournament_id", id).order("name"),
    sb.from("pairs").select("*, pair_players(*, team_players(*))").order("created_at"),
    sb.from("matches").select("*").eq("tournament_id", id).order("match_number"),
  ]);

  const teams: TeamWithPlayers[] = (teamsRes.data ?? []) as TeamWithPlayers[];
  const groups: GroupWithTeams[] = (groupsRes.data ?? []) as GroupWithTeams[];
  const allMatches: Match[] = (matchesRes.data ?? []) as Match[];

  // Filter pairs to those of this tournament's teams
  const teamIds = new Set(teams.map((tt) => tt.id));
  type RawPair = {
    id: string;
    team_id: string;
    name: string | null;
    created_at: string;
    pair_players: { pair_id: string; player_id: string; team_players: unknown }[];
  };
  const pairs: PairWithPlayers[] = ((pairsRes.data ?? []) as RawPair[])
    .filter((p) => teamIds.has(p.team_id))
    .map((p) => ({
      id: p.id,
      team_id: p.team_id,
      name: p.name,
      created_at: p.created_at,
      players: p.pair_players.map((pp) => ({
        ...(pp.team_players as Record<string, unknown>),
        pair_player: { pair_id: pp.pair_id, player_id: pp.player_id },
      })) as PairWithPlayers["players"],
    }));

  const flatTeams: Team[] = teams.map(({ players: _p, ...x }) => x as Team);
  const isOwner = session?.profileId === t.owner_id;
  const s = statusLabel[t.status];
  const showGroupStage = t.match_unit === "team" && (t.format === "group_only" || t.format === "group_knockout");
  const showPairStage = t.match_unit === "pair";

  return (
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
        </CardContent>
      </Card>

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
    </div>
  );
}
