import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { Separator } from "@/components/ui/separator";
import { BracketView } from "@/components/tournament/bracket-view";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import { TvAutoRefresh } from "@/components/tournament/tv-auto-refresh";
import { PublicTvHeader } from "@/components/tournament/public/public-tv-header";
import { buildVisualBracket } from "@/lib/tournament/bracket-visual";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { parseSettings } from "@/lib/tournament/settings";
import { divisionLabelTh, parseDivision } from "@/lib/tournament/divisions";
import type { Tournament, Team, PairWithPlayers, Match } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PublicBracketPage({
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
    .maybeSingle();

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
    ? await sb
        .from("pairs")
        .select(
          "*, player1:team_players!player_id_1(*), player2:team_players!player_id_2(*)"
        )
        .in("team_id", teamIdList)
        .order("created_at")
    : { data: [] };

  const teams: Team[] = (teamsRes.data ?? []) as Team[];
  const pairs: PairWithPlayers[] = (pairsRes.data ?? []) as unknown as PairWithPlayers[];
  const allMatches: Match[] = (matchesRes.data ?? []) as Match[];

  const unit = t.match_unit;
  const competitorMap = buildCompetitorMap(unit, teams, pairs);
  const settings = parseSettings(t.settings);

  const knockoutMatches = allMatches.filter((m) => m.round_type === "knockout");

  // Group knockout matches by division (pair mode + thresholds set), so each
  // division renders its own independent bracket. parseDivision returns null
  // for matches with no division (team mode or no thresholds set) — those
  // collapse into a single null-keyed bucket.
  const divisionBuckets = new Map<number | null, Match[]>();
  for (const m of knockoutMatches) {
    const k = parseDivision(m.division);
    const arr = divisionBuckets.get(k);
    if (arr) arr.push(m);
    else divisionBuckets.set(k, [m]);
  }
  // Order: null first (single-bucket mode), then 1..N ascending
  const divisionKeys = Array.from(divisionBuckets.keys()).sort((a, b) => {
    if (a === b) return 0;
    if (a === null) return -1;
    if (b === null) return 1;
    return a - b;
  });

  type DivisionBracketSet = {
    divKey: number | null;
    upperRounds: ReturnType<typeof buildVisualBracket>;
    lowerRounds: ReturnType<typeof buildVisualBracket>;
    grandFinalRounds: ReturnType<typeof buildVisualBracket>;
  };

  const divisionBracketSets: DivisionBracketSet[] = divisionKeys.map((divKey) => {
    const ms = divisionBuckets.get(divKey) ?? [];
    return {
      divKey,
      upperRounds: buildVisualBracket(ms, "upper"),
      lowerRounds: buildVisualBracket(ms, "lower"),
      grandFinalRounds: buildVisualBracket(ms, "grand_final"),
    };
  });

  const hasBracket = divisionBracketSets.some((s) => s.upperRounds.length > 0);
  const isMultiDivision = divisionBracketSets.length > 1;

  return (
    <TournamentLiveWrapper
      tournamentId={t.id}
      isOngoing={t.status === "ongoing"}
      realtimeEnabled={settings.realtime_enabled}
    >
      <TvAutoRefresh intervalMs={settings.tv_refresh_interval_sec * 1000} />
      <div className="h-screen w-screen overflow-hidden flex flex-col bg-background text-foreground p-3 lg:p-4">
        {/* Hero — fixed-height header */}
        <PublicTvHeader
          name={t.name}
          venue={t.venue}
          status={t.status}
          backLink={{ href: `/t/${token}/tv`, label: "ออก" }}
        />

        {!hasBracket ? (
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <p className="text-2xl lg:text-4xl 2xl:text-5xl text-muted-foreground">
              ยังไม่มีสายน็อคเอ้า
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto pt-3">
            {divisionBracketSets.map((set, dIdx) => {
              const { divKey, upperRounds, lowerRounds, grandFinalRounds } = set;
              const hasUpper = upperRounds.length > 0;
              if (!hasUpper) return null;
              const hasLower = lowerRounds.length > 0;
              const hasGrandFinal = grandFinalRounds.length > 0;
              const isMultiSection = hasLower || hasGrandFinal;
              return (
                <div key={`div-${divKey ?? "none"}`}>
                  {isMultiDivision && divKey !== null && (
                    <h2 className="text-base lg:text-lg font-semibold mb-3">
                      {divisionLabelTh(divKey)}
                    </h2>
                  )}

                  <section className="space-y-1">
                    {isMultiSection && (
                      <h3 className="text-sm font-semibold text-muted-foreground mb-4">สายบน</h3>
                    )}
                    <BracketView rounds={upperRounds} competitorById={competitorMap} unit={unit} />
                  </section>

                  {hasLower && (
                    <>
                      <Separator className="my-8" />
                      <section className="space-y-1">
                        <h3 className="text-sm font-semibold text-muted-foreground mb-4">สายล่าง</h3>
                        <BracketView rounds={lowerRounds} competitorById={competitorMap} unit={unit} />
                      </section>
                    </>
                  )}

                  {hasGrandFinal && (
                    <>
                      <Separator className="my-8" />
                      <section className="space-y-1">
                        <h3 className="text-sm font-semibold text-muted-foreground mb-4">Grand Final</h3>
                        <BracketView
                          rounds={grandFinalRounds}
                          competitorById={competitorMap}
                          unit={unit}
                        />
                      </section>
                    </>
                  )}

                  {isMultiDivision && dIdx < divisionBracketSets.length - 1 && (
                    <Separator className="my-10" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </TournamentLiveWrapper>
  );
}
