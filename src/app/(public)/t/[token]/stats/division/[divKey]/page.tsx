import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import { DivisionStatsView } from "@/components/tournament/stats/division-stats-view";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { computeDivisionStats } from "@/lib/tournament/entity-stats";
import { parseSettings } from "@/lib/tournament/settings";
import { computePairDivision, parsePairLevel } from "@/lib/tournament/divisions";
import type { Tournament, Team, PairWithPlayers, Match } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PublicDivisionStatsPage({
  params,
}: {
  params: Promise<{ token: string; divKey: string }>;
}) {
  const { token, divKey } = await params;
  const division = parseInt(decodeURIComponent(divKey), 10);
  const sb = await createAdminClient();

  // Resolve tournament by share token (no auth required)
  const { data: tournament } = await sb
    .from("tournaments")
    .select("*")
    .eq("share_token", token)
    .maybeSingle();

  if (!tournament) notFound();
  const t = tournament as Tournament;

  // Validate division param is within range
  const thresholds: number[] = t.pair_division_thresholds ?? [];
  const maxDivision = thresholds.length + 1;
  if (!Number.isFinite(division) || division < 1 || division > maxDivision) {
    notFound();
  }

  // Fetch matches + teams in parallel; pairs follow (need teamIds)
  const [matchesRes, teamsRes] = await Promise.all([
    sb.from("matches").select("*").eq("tournament_id", t.id).order("match_number"),
    sb.from("teams").select("*").eq("tournament_id", t.id).order("created_at"),
  ]);

  const teamIdList = (teamsRes.data ?? []).map((x) => x.id);
  const pairsRes = teamIdList.length
    ? await sb
        .from("pairs")
        .select(
          "*, player1:team_players!player_id_1(*), player2:team_players!player_id_2(*)"
        )
        .in("team_id", teamIdList)
        .order("created_at")
    : { data: [] };

  const teams: Team[] = (teamsRes.data ?? []) as Team[];
  const allMatches: Match[] = (matchesRes.data ?? []) as Match[];
  const pairs: PairWithPlayers[] = (pairsRes.data ?? []) as unknown as PairWithPlayers[];

  // Filter pairs belonging to this division
  const divisionPairs =
    thresholds.length > 0
      ? pairs.filter(
          (p) => computePairDivision(parsePairLevel(p.pair_level), thresholds) === division
        )
      : pairs; // no split → all pairs

  const competitorById = buildCompetitorMap("pair", teams, pairs);
  const stats = computeDivisionStats({ division, pairs, matches: allMatches, thresholds });
  const settings = parseSettings(t.settings);

  return (
    <TournamentLiveWrapper tournamentId={t.id} realtimeEnabled={settings.realtime_enabled}>
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <Link
          href={`/t/${token}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับ
        </Link>

        <DivisionStatsView
          stats={stats}
          division={division}
          divisionPairs={divisionPairs}
          competitorById={competitorById}
        />
      </div>
    </TournamentLiveWrapper>
  );
}
