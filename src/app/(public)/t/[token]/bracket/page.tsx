import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { Separator } from "@/components/ui/separator";
import { BracketView } from "@/components/tournament/bracket-view";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import { TvAutoRefresh } from "@/components/tournament/tv-auto-refresh";
import { TvFullscreenButton } from "@/components/tournament/tv-fullscreen-button";
import { buildVisualBracket } from "@/lib/tournament/bracket-visual";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { parseSettings } from "@/lib/tournament/settings";
import type { Tournament, Team, PairWithPlayers, Match } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_TEXT: Record<string, string> = {
  draft: "แบบร่าง",
  registering: "เปิดรับสมัคร",
  ongoing: "กำลังแข่ง",
  completed: "จบแล้ว",
};

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
    .single();

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

  const upperRounds = buildVisualBracket(knockoutMatches, "upper");
  const lowerRounds = buildVisualBracket(knockoutMatches, "lower");
  const grandFinalRounds = buildVisualBracket(knockoutMatches, "grand_final");

  const hasBracket = upperRounds.length > 0;
  const hasLower = lowerRounds.length > 0;
  const hasGrandFinal = grandFinalRounds.length > 0;
  const isMultiSection = hasLower || hasGrandFinal;

  return (
    <TournamentLiveWrapper
      tournamentId={t.id}
      isOngoing={t.status === "ongoing"}
      realtimeEnabled={settings.realtime_enabled}
    >
      <TvAutoRefresh intervalMs={60_000} />
      <div className="h-screen w-screen overflow-hidden flex flex-col bg-background text-foreground p-3 lg:p-4">
        {/* Hero — fixed-height header */}
        <header className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b pb-3">
          <div className="min-w-0">
            <h1 className="text-2xl lg:text-4xl xl:text-5xl 2xl:text-6xl font-bold truncate leading-tight">
              {t.name}
            </h1>
            {t.venue && (
              <p className="text-sm lg:text-xl 2xl:text-2xl text-muted-foreground truncate leading-tight">
                {t.venue}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 lg:gap-4">
            <span className="px-3 py-1 lg:px-4 lg:py-1.5 rounded-full border text-sm lg:text-lg 2xl:text-xl font-semibold">
              {STATUS_TEXT[t.status] ?? t.status}
            </span>
            <TvFullscreenButton />
            <Link
              href={`/t/${token}/tv`}
              className="text-sm lg:text-base 2xl:text-lg text-muted-foreground hover:text-foreground underline"
            >
              ออก
            </Link>
          </div>
        </header>

        {!hasBracket ? (
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <p className="text-2xl lg:text-4xl 2xl:text-5xl text-muted-foreground">
              ยังไม่มีสายน็อคเอ้า
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto pt-3">
            <section className="space-y-1">
              {isMultiSection && (
                <h2 className="text-sm font-semibold text-muted-foreground mb-4">สายบน</h2>
              )}
              <BracketView rounds={upperRounds} competitorById={competitorMap} unit={unit} />
            </section>

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
                  <BracketView
                    rounds={grandFinalRounds}
                    competitorById={competitorMap}
                    unit={unit}
                  />
                </section>
              </>
            )}
          </div>
        )}
      </div>
    </TournamentLiveWrapper>
  );
}
