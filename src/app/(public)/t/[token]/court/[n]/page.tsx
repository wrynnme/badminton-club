import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import { TvAutoRefresh } from "@/components/tournament/tv-auto-refresh";
import { ScheduleMatchCard } from "@/components/tournament/schedule-match-card";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { parseSettings } from "@/lib/tournament/settings";
import { Badge } from "@/components/ui/badge";
import type { Tournament, Team, PairWithPlayers, Match } from "@/lib/types";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function CourtRefereePage({
  params,
}: {
  params: Promise<{ token: string; n: string }>;
}) {
  const { token, n } = await params;
  // Court names are free text — URL-decode once and use throughout.
  // Guard against malformed escape sequences (e.g. %E0%A4 alone) which throw URIError.
  let courtName: string;
  try {
    courtName = decodeURIComponent(n);
  } catch {
    notFound();
  }

  const sb = await createAdminClient();

  const { data: tournament } = await sb
    .from("tournaments")
    .select("*")
    .eq("share_token", token)
    .maybeSingle();

  if (!tournament) notFound();
  const t = tournament as Tournament;

  // Single-wave parallel fetch (TV page pattern — no second roundtrip for pairs).
  const [teamsRes, matchesRes, pairsRes] = await Promise.all([
    sb.from("teams").select("*").eq("tournament_id", t.id).order("created_at"),
    sb
      .from("matches")
      .select("*")
      .eq("tournament_id", t.id)
      .eq("court", courtName)
      .order("match_number"),
    sb
      .from("pairs")
      .select(
        "*, player1:team_players!player_id_1(id, display_name), player2:team_players!player_id_2(id, display_name), team:teams!inner(tournament_id)"
      )
      .eq("team.tournament_id", t.id)
      .order("created_at"),
  ]);

  const teams: Team[] = (teamsRes.data ?? []) as Team[];
  const pairs: PairWithPlayers[] = (pairsRes.data ?? []) as unknown as PairWithPlayers[];
  const courtMatches: Match[] = (matchesRes.data ?? []) as Match[];

  const unit = t.match_unit;
  const competitorMap = buildCompetitorMap(unit, teams, pairs);
  const settings = parseSettings(t.settings);

  // In-progress: sorted by match_number ascending.
  const inProgressMatches = courtMatches
    .filter((m) => m.status === "in_progress")
    .sort((a, b) => a.match_number - b.match_number);

  // Next pending: sorted by (queue_position ?? match_number) ascending, top 2 only.
  const pendingMatches = courtMatches
    .filter((m) => m.status === "pending")
    .sort(
      (a, b) =>
        (a.queue_position ?? a.match_number) - (b.queue_position ?? b.match_number)
    )
    .slice(0, 2);

  const hasAny = inProgressMatches.length > 0 || pendingMatches.length > 0;
  const isLive = inProgressMatches.length > 0;

  return (
    <TournamentLiveWrapper tournamentId={t.id} realtimeEnabled={settings.realtime_enabled}>
      {/* Polling fallback: 30s on referee view (shorter than TV 60s for responsiveness) */}
      <TvAutoRefresh intervalMs={30_000} />

      <div className="min-h-screen bg-background text-foreground">
        <div className="max-w-xl mx-auto px-4 py-6 space-y-4">

          {/* Header */}
          <header className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-bold truncate">สนาม {courtName}</h1>
              {isLive && (
                <Badge className="shrink-0 bg-green-600 hover:bg-green-600 text-white gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  LIVE
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate">{t.name}</p>
          </header>

          {/* Empty state */}
          {!hasAny && (
            <div className="rounded-xl border bg-muted/30 py-16 flex flex-col items-center justify-center gap-2 text-center">
              <p className="text-xl font-semibold text-muted-foreground">
                ไม่มีแมตช์ที่สนาม {courtName}
              </p>
              <p className="text-sm text-muted-foreground">
                รอการแข่งขันถูกกำหนดให้สนามนี้
              </p>
            </div>
          )}

          {/* In-progress section */}
          {inProgressMatches.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                กำลังแข่ง
              </h2>
              {inProgressMatches.map((m) => (
                <ScheduleMatchCard
                  key={m.id}
                  match={m}
                  competitorById={competitorMap}
                  unit={unit}
                  size="large"
                />
              ))}
            </section>
          )}

          {/* Next pending section */}
          {pendingMatches.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                ถัดไป
              </h2>
              {pendingMatches.map((m) => (
                <ScheduleMatchCard
                  key={m.id}
                  match={m}
                  competitorById={competitorMap}
                  unit={unit}
                  size="normal"
                />
              ))}
            </section>
          )}

        </div>
      </div>
    </TournamentLiveWrapper>
  );
}
