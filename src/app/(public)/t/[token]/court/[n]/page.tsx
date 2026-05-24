import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { TournamentLiveWrapper } from "@/components/tournament/tournament-live-wrapper";
import { TvAutoRefresh } from "@/components/tournament/tv-auto-refresh";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { gameWinner, sumGameScores } from "@/lib/tournament/scoring";
import { parseSettings } from "@/lib/tournament/settings";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Tournament, Team, PairWithPlayers, Match } from "@/lib/types";
import type { Competitor } from "@/lib/tournament/competitor";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format elapsed ms as "Xm Ys" — used for in-progress started_at display. */
function formatElapsed(startedAt: string | null): string | null {
  if (!startedAt) return null;
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  if (elapsedMs < 0) return null;
  const totalSec = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

// ---------------------------------------------------------------------------
// Sub-components (server, no "use client")
// ---------------------------------------------------------------------------

function CompetitorBlock({
  competitor,
  isWinner,
  isLoser,
  align = "left",
}: {
  competitor: Competitor | undefined;
  isWinner: boolean;
  isLoser: boolean;
  align?: "left" | "right";
}) {
  const nameColor = isWinner
    ? "text-green-600 dark:text-green-400"
    : isLoser
      ? "text-muted-foreground line-through"
      : "text-foreground";

  const alignClass = align === "right" ? "text-right items-end" : "text-left items-start";

  return (
    <div className={`flex-1 min-w-0 flex flex-col gap-0.5 ${alignClass}`}>
      {competitor?.color && (
        <span
          className="inline-block w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: competitor.color }}
        />
      )}
      <span
        className={`text-xl font-bold leading-tight truncate ${nameColor} ${isWinner ? "font-extrabold" : ""}`}
      >
        {competitor?.name ?? "—"}
      </span>
      {competitor?.subtitle && (
        <span className="text-xs text-muted-foreground truncate">{competitor.subtitle}</span>
      )}
    </div>
  );
}

function MatchCard({
  match,
  competitorById,
  unit,
  size = "normal",
}: {
  match: Match;
  competitorById: Map<string, Competitor>;
  unit: "team" | "pair";
  size?: "large" | "normal";
}) {
  const aId = unit === "team" ? match.team_a_id : match.pair_a_id;
  const bId = unit === "team" ? match.team_b_id : match.pair_b_id;
  const a = aId ? competitorById.get(aId) : undefined;
  const b = bId ? competitorById.get(bId) : undefined;

  const winner = match.status === "completed" ? gameWinner(match.games) : null;
  const totals = match.status === "completed" ? sumGameScores(match.games) : null;
  const gamesA = match.team_a_score ?? 0;
  const gamesB = match.team_b_score ?? 0;

  const elapsed = match.status === "in_progress" ? formatElapsed(match.started_at) : null;

  const isLarge = size === "large";

  const statusLabel =
    match.status === "in_progress"
      ? "กำลังเล่น"
      : match.status === "completed"
        ? "จบแล้ว"
        : "รอแข่ง";

  const statusCls =
    match.status === "in_progress"
      ? "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30"
      : match.status === "completed"
        ? "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30"
        : "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30";

  return (
    <Card className={isLarge ? "border-2" : ""}>
      <CardContent className={isLarge ? "p-4 space-y-3" : "p-3 space-y-2"}>
        {/* Top row: status + match number + elapsed */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className={`px-2 py-0.5 rounded-full border font-medium ${statusCls}`}>
            {statusLabel}
          </span>
          <div className="flex items-center gap-2 text-muted-foreground font-mono">
            {elapsed && (
              <span className="text-green-600 dark:text-green-400 font-semibold">{elapsed}</span>
            )}
            <span>#{match.match_number}</span>
          </div>
        </div>

        {/* Competitors + score row */}
        <div className="flex items-center gap-3">
          <CompetitorBlock
            competitor={a}
            isWinner={winner === "a"}
            isLoser={winner === "b"}
            align="left"
          />

          {/* Score / VS */}
          <div className="shrink-0 text-center px-1">
            {match.status === "completed" ? (
              <div>
                <div className={`tabular-nums font-bold ${isLarge ? "text-3xl" : "text-2xl"}`}>
                  {gamesA} : {gamesB}
                </div>
                {totals && (
                  <div className="text-muted-foreground tabular-nums text-xs mt-0.5">
                    ({totals.a}–{totals.b})
                  </div>
                )}
              </div>
            ) : (
              <span className={`text-muted-foreground font-bold ${isLarge ? "text-2xl" : "text-xl"}`}>
                VS
              </span>
            )}
          </div>

          <CompetitorBlock
            competitor={b}
            isWinner={winner === "b"}
            isLoser={winner === "a"}
            align="right"
          />
        </div>

        {/* Division badge if present */}
        {match.division && (
          <div className="flex justify-center">
            <Badge variant="outline" className="text-xs">
              Division {match.division}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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
                <MatchCard
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
                <MatchCard
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
