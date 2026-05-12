import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { BracketView } from "@/components/tournament/bracket-view";
import { buildVisualBracket } from "@/lib/tournament/bracket-visual";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import type { Tournament, TeamWithPlayers, PairWithPlayers, Match, Team } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BracketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createAdminClient();

  const { data: tournament } = await sb.from("tournaments").select("*").eq("id", id).single();
  if (!tournament) notFound();
  const t = tournament as Tournament;

  const teamsRes = await sb
    .from("teams")
    .select("*, players:team_players(*)")
    .eq("tournament_id", id)
    .order("created_at");

  const teamIdList = (teamsRes.data ?? []).map((t) => t.id);

  const [pairsRes, matchesRes] = await Promise.all([
    teamIdList.length
      ? sb
          .from("pairs")
          .select("*, player1:team_players!player_id_1(*), player2:team_players!player_id_2(*)")
          .in("team_id", teamIdList)
      : Promise.resolve({ data: [] }),
    sb
      .from("matches")
      .select("*")
      .eq("tournament_id", id)
      .eq("round_type", "knockout")
      .order("match_number"),
  ]);

  const teams: TeamWithPlayers[] = (teamsRes.data ?? []) as TeamWithPlayers[];
  const flatTeams: Team[] = teams.map(({ players: _p, ...x }) => x as Team);
  const pairs: PairWithPlayers[] = (pairsRes.data ?? []) as unknown as PairWithPlayers[];
  const matches: Match[] = (matchesRes.data ?? []) as Match[];

  const unit = t.match_unit;
  const competitorMap = buildCompetitorMap(unit, flatTeams, pairs);

  const upperRounds = buildVisualBracket(matches, "upper");
  const lowerRounds = buildVisualBracket(matches, "lower");
  const grandFinalRounds = buildVisualBracket(matches, "grand_final");

  const hasBracket = upperRounds.length > 0;
  const hasLower = lowerRounds.length > 0;
  const hasGrandFinal = grandFinalRounds.length > 0;
  const isMultiSection = hasLower || hasGrandFinal;

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-[1400px] mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Button render={<Link href={`/tournaments/${id}`} />} variant="ghost" size="sm">
          <ArrowLeft className="h-4 w-4 mr-1" />
          กลับ
        </Button>
        <div>
          <h1 className="text-lg font-bold leading-tight">{t.name}</h1>
          <p className="text-xs text-muted-foreground">สายการแข่งขัน</p>
        </div>
      </div>

      {!hasBracket && (
        <p className="text-sm text-muted-foreground">ยังไม่มีสาย knockout — กลับไปสร้างตารางก่อน</p>
      )}

      {hasBracket && (
        <section className="space-y-1">
          {isMultiSection && (
            <h2 className="text-sm font-semibold text-muted-foreground mb-4">สายบน</h2>
          )}
          <BracketView rounds={upperRounds} competitorById={competitorMap} unit={unit} />
        </section>
      )}

      {hasLower && (
        <>
          <Separator className="my-8" />
          <section className="space-y-1">
            <h2 className="text-sm font-semibold text-muted-foreground mb-4">สายล่าง</h2>
            <BracketView rounds={lowerRounds} competitorById={competitorMap} unit={unit} />
          </section>
        </>
      )}

      {hasGrandFinal && (
        <>
          <Separator className="my-8" />
          <section className="space-y-1">
            <h2 className="text-sm font-semibold text-muted-foreground mb-4">Grand Final</h2>
            <BracketView rounds={grandFinalRounds} competitorById={competitorMap} unit={unit} />
          </section>
        </>
      )}
    </div>
  );
}
