import { notFound } from "next/navigation";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { PrintButton } from "@/components/ui/print-button";
import { getTranslations } from "next-intl/server";
import type { Tournament, Team, Match, PairWithPlayers, TournamentClass } from "@/lib/types";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { computePrizeResult, parsePrizeTemplate } from "@/lib/tournament/prizes";
import type { PrizeTemplateEntry, PrizeResult } from "@/lib/tournament/prizes";
import type { Competitor } from "@/lib/tournament/competitor";
import { parseTournamentThresholds, divisionCount, divisionTone } from "@/lib/tournament/divisions";
import { classToneById } from "@/lib/tournament/class-color";
import { PrizeTemplateEditor } from "@/components/tournament/prize-template-editor";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function PrizesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createAdminClient();

  const [session, { data: tournamentData }] = await Promise.all([
    getSession(),
    sb.from("tournaments").select("*").eq("id", id).single(),
  ]);

  if (!tournamentData) notFound();
  const tournament = tournamentData as Tournament;

  const isOwner = session?.profileId === tournament.owner_id;

  const [teamsRes, pairsRes, matchesRes, classesRes, adminRes] = await Promise.all([
    sb.from("teams").select("id, name, color, seed, tournament_id, created_at").eq("tournament_id", id).order("created_at"),
    sb
      .from("pairs")
      .select("*, player1:team_players!player_id_1(*), player2:team_players!player_id_2(*), team:teams!inner(tournament_id)")
      .eq("team.tournament_id", id)
      .order("created_at"),
    sb.from("matches").select("*").eq("tournament_id", id).order("match_number"),
    sb.from("tournament_classes").select("*").eq("tournament_id", id).order("position"),
    (session?.profileId && !isOwner)
      ? sb.from("tournament_admins").select("user_id").eq("tournament_id", id).eq("user_id", session.profileId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const teams: Team[] = (teamsRes.data ?? []) as Team[];
  const pairs: PairWithPlayers[] = (pairsRes.data ?? []) as unknown as PairWithPlayers[];
  const allMatches: Match[] = (matchesRes.data ?? []) as Match[];
  const classes: TournamentClass[] = (classesRes.data ?? []) as TournamentClass[];

  const isCoAdmin = !!adminRes.data;
  const canEdit = isOwner || isCoAdmin;

  const competitorMap = buildCompetitorMap(tournament.match_unit, teams, pairs);
  const prizeTemplate = parsePrizeTemplate(tournament.prize_template);

  const tl = await getTranslations("tournament");

  // Build scopes
  type Scope = {
    key: string;
    label: string | null;
    matches: Match[];
    accentBorder: string;
    accentBg: string;
    accentText: string;
  };

  const thresholds = parseTournamentThresholds(tournament.pair_division_thresholds);
  const isCompetition = tournament.mode === "competition";

  let scopes: Scope[];

  if (isCompetition && classes.length > 0) {
    scopes = classes.map((cls) => {
      const tone = classToneById(classes, cls.id);
      return {
        key: cls.id,
        label: cls.name || cls.code,
        matches: allMatches.filter((m) => m.class_id === cls.id),
        accentBorder: tone.border,
        accentBg: tone.bg,
        accentText: tone.text,
      };
    });
  } else if (thresholds.length > 0) {
    const count = divisionCount(thresholds);
    scopes = Array.from({ length: count }, (_, i) => {
      const divNum = i + 1;
      const tone = divisionTone(divNum);
      return {
        key: String(divNum),
        label: tl("prizes.divisionScope", { n: divNum }),
        matches: allMatches.filter((m) => m.division === String(divNum)),
        accentBorder: tone.border,
        accentBg: tone.bg,
        accentText: tone.text,
      };
    });
  } else {
    scopes = [
      {
        key: "all",
        label: null,
        matches: allMatches,
        accentBorder: "border-border",
        accentBg: "bg-muted/30",
        accentText: "text-foreground",
      },
    ];
  }

  // Compute results for each scope
  type ScopeWithResult = Scope & { result: PrizeResult };
  const scopeResults: ScopeWithResult[] = scopes.map((s) => ({
    ...s,
    result: computePrizeResult(s.matches, competitorMap),
  }));

  const anyHasBracket = scopeResults.some((s) => s.result.hasBracket);

  // Resolve a competitor display slot given template rank and computed result
  function resolveCompetitor(rank: number, result: PrizeResult): Competitor | null {
    if (rank === 1) return result.champion;
    if (rank === 2) return result.runnerUp;
    // rank 3+ → index into semifinalists (rank 3 = index 0, rank 4 = index 1, …)
    return result.semifinalists[rank - 3] ?? null;
  }

  // Build default template rows if none configured
  function defaultRows(result: PrizeResult): PrizeTemplateEntry[] {
    const rows: PrizeTemplateEntry[] = [
      { rank: 1, label: tl("prizes.champion"), cash: 0, trophy: false },
      { rank: 2, label: tl("prizes.runnerUp"), cash: 0, trophy: false },
    ];
    result.semifinalists.forEach((_, i) => {
      rows.push({ rank: 3 + i, label: tl("prizes.semifinalist"), cash: 0, trophy: false });
    });
    return rows;
  }

  const entityType = tournament.match_unit === "team" ? "team" : "pair";

  return (
    <div className="p-8 max-w-4xl mx-auto font-sans">
      {/* Controls bar — hidden on print */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href={`/tournaments/${id}`} className="text-sm underline text-blue-600">
          {tl("prizes.back")}
        </Link>
        <PrintButton />
      </div>

      {/* Page header */}
      <div className="mb-2 flex items-center gap-2">
        <Trophy className="h-6 w-6 shrink-0" />
        <h1 className="text-2xl font-bold">{tournament.name}</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">{tl("prizes.pageSubtitle")}</p>

      {/* Owner-only prize template editor — hidden on print */}
      {canEdit && (
        <div className="mb-8 print:hidden">
          <PrizeTemplateEditor tournamentId={id} initial={prizeTemplate} />
        </div>
      )}

      {/* No bracket at all */}
      {!anyHasBracket && (
        <p className="text-sm text-muted-foreground">{tl("prizes.noBracketYet")}</p>
      )}

      {/* Prize blocks per scope */}
      {anyHasBracket &&
        scopeResults.map((scope) => {
          if (!scope.result.hasBracket) return null;

          const rows = prizeTemplate.length > 0 ? prizeTemplate : defaultRows(scope.result);

          return (
            <section key={scope.key} className={`mb-10 rounded-lg border p-5 ${scope.accentBorder} ${scope.accentBg}`}>
              {scope.label && (
                <h2 className={`text-lg font-semibold mb-4 ${scope.accentText}`}>
                  {isCompetition
                    ? tl("prizes.classScope", { name: scope.label })
                    : scope.label}
                </h2>
              )}

              <Table>
                <TableHeader>
                  <TableRow className="border-border/60 hover:bg-transparent">
                    <TableHead className="w-12 font-semibold">{tl("prizes.rankCol")}</TableHead>
                    <TableHead className="w-32 font-semibold">{tl("prizes.labelCol")}</TableHead>
                    <TableHead className="font-semibold">{tl("prizes.winnerCol")}</TableHead>
                    <TableHead className="w-32 text-right font-semibold">{tl("prizes.cashCol")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => {
                    const competitor = resolveCompetitor(row.rank, scope.result);
                    const isDecided = scope.result.finalDecided || (row.rank >= 3 && scope.result.semifinalists.length > 0);
                    const displayName = competitor
                      ? competitor.name
                      : isDecided
                        ? "—"
                        : tl("prizes.notDecided");

                    return (
                      <TableRow key={i} className="border-border/30 hover:bg-transparent">
                        <TableCell className="text-muted-foreground font-mono">{row.rank}</TableCell>
                        <TableCell className="font-medium">
                          {row.trophy && <Trophy className="inline h-3.5 w-3.5 mr-1 text-yellow-500" />}
                          {row.label}
                        </TableCell>
                        <TableCell>
                          {competitor ? (
                            <CompetitorName
                              competitor={competitor}
                              entityType={entityType}
                              tournamentId={id}
                            />
                          ) : (
                            <span className="text-muted-foreground">{displayName}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.cash > 0 ? (
                            <span className="font-semibold text-green-700 dark:text-green-400">
                              {tl("prizes.cashAmount", { amount: row.cash.toLocaleString() })}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </section>
          );
        })}
    </div>
  );
}

// Inline server-side competitor name — wraps in a Next Link to stats page.
function CompetitorName({
  competitor,
  entityType,
  tournamentId,
}: {
  competitor: Competitor;
  entityType: "team" | "pair";
  tournamentId: string;
}) {
  const href = `/tournaments/${tournamentId}/stats/${entityType}/${encodeURIComponent(competitor.id)}`;
  return (
    <Link href={href} className="font-semibold hover:underline">
      {competitor.name}
    </Link>
  );
}
