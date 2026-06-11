import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { BracketView } from "@/components/tournament/bracket-view";
import { buildVisualBracket } from "@/lib/tournament/bracket-visual";
import { buildCompetitorMap } from "@/lib/tournament/competitor";
import { PrintButton } from "@/components/ui/print-button";
import { classTone, NEUTRAL_TONE, type ClassTone } from "@/lib/tournament/class-color";
import { getTranslations } from "next-intl/server";
import type { Tournament, TeamWithPlayers, PairWithPlayers, Match, Team, TournamentClass } from "@/lib/types";

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

  const [pairsRes, matchesRes, classesRes] = await Promise.all([
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
    sb
      .from("tournament_classes")
      .select("*")
      .eq("tournament_id", id)
      .order("position"),
  ]);

  const teams: TeamWithPlayers[] = (teamsRes.data ?? []) as TeamWithPlayers[];
  const flatTeams: Team[] = teams.map(({ players: _p, ...x }) => x as Team);
  const pairs: PairWithPlayers[] = (pairsRes.data ?? []) as unknown as PairWithPlayers[];
  const matches: Match[] = (matchesRes.data ?? []) as Match[];
  const classes: TournamentClass[] = (classesRes.data ?? []) as TournamentClass[];

  const unit = t.match_unit;
  const competitorMap = buildCompetitorMap(unit, flatTeams, pairs);
  const isCompetition = classes.length > 0;

  const tl = await getTranslations("tournament");

  // ── Page shell ──────────────────────────────────────────────────────────────
  const pageHeader = (
    <>
      <div className="mb-6 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <Button render={<Link href={`/tournaments/${id}`} />} nativeButton={false} variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {tl("page.back")}
          </Button>
          <div>
            <h1 className="text-lg font-bold leading-tight">{t.name}</h1>
            <p className="text-xs text-muted-foreground">{tl("page.bracketTitle")}</p>
          </div>
        </div>
        <PrintButton />
      </div>
      <div className="mb-6 hidden print:block">
        <h1 className="text-lg font-bold leading-tight">{t.name}</h1>
        <p className="text-xs text-muted-foreground">{tl("page.bracketTitle")}</p>
      </div>
    </>
  );

  // ── Competition mode: one section per class ──────────────────────────────────
  if (isCompetition) {
    const classIds = new Set(classes.map((c) => c.id));
    // One display group per class (tone keyed to full position order so colors
    // match the pair/queue/stage views) + an "unassigned" group catching any
    // knockout match whose class_id is null/unknown so none silently vanish.
    const groups: Array<{ key: string; code: string; name: string; tone: ClassTone; matches: Match[] }> = classes.map(
      (cls, i) => ({ key: cls.id, code: cls.code, name: cls.name, tone: classTone(i), matches: matches.filter((m) => m.class_id === cls.id) }),
    );
    const orphanMatches = matches.filter((m) => !m.class_id || !classIds.has(m.class_id));
    if (orphanMatches.length > 0) {
      groups.push({ key: "__unassigned__", code: tl("page.bracketUnassignedClass"), name: "", tone: NEUTRAL_TONE, matches: orphanMatches });
    }

    const renderedGroups = groups
      .map((g) => {
        const upper = buildVisualBracket(g.matches, "upper");
        const lower = buildVisualBracket(g.matches, "lower");
        const grandFinal = buildVisualBracket(g.matches, "grand_final");
        return { ...g, upper, lower, grandFinal, hasAny: upper.length > 0 || lower.length > 0 || grandFinal.length > 0 };
      })
      .filter((g) => g.hasAny);

    return (
      <div className="min-h-screen p-4 md:p-8 max-w-[1400px] mx-auto">
        {pageHeader}
        {renderedGroups.length === 0 && (
          <p className="text-sm text-muted-foreground">{tl("page.bracketEmpty")}</p>
        )}
        {renderedGroups.map(({ key, code, name, tone, upper, lower, grandFinal }, idx) => {
          const hasLower = lower.length > 0;
          const hasGrandFinal = grandFinal.length > 0;
          const isMultiSection = hasLower || hasGrandFinal;
          return (
            <div key={key}>
              {idx > 0 && <Separator className="my-10" />}
              {/* Group header */}
              <div className={`mb-4 pb-2 border-b-2 ${tone.border}`}>
                <span className={`text-sm font-bold ${tone.text}`}>{code}</span>
                {name && <span className="text-sm text-muted-foreground ml-2">{name}</span>}
              </div>
              <section className="space-y-1">
                {isMultiSection && (
                  <h3 className="text-xs font-semibold text-muted-foreground mb-3">{tl("page.bracketUpper")}</h3>
                )}
                <BracketView rounds={upper} competitorById={competitorMap} unit={unit} />
              </section>
              {hasLower && (
                <>
                  <Separator className="my-6" />
                  <section className="space-y-1">
                    <h3 className="text-xs font-semibold text-muted-foreground mb-3">{tl("page.bracketLower")}</h3>
                    <BracketView rounds={lower} competitorById={competitorMap} unit={unit} />
                  </section>
                </>
              )}
              {hasGrandFinal && (
                <>
                  <Separator className="my-6" />
                  <section className="space-y-1">
                    <h3 className="text-xs font-semibold text-muted-foreground mb-3">{tl("page.bracketGrandFinal")}</h3>
                    <BracketView rounds={grandFinal} competitorById={competitorMap} unit={unit} />
                  </section>
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ── Sports-day mode: existing single-view behavior ───────────────────────────
  const upperRounds = buildVisualBracket(matches, "upper");
  const lowerRounds = buildVisualBracket(matches, "lower");
  const grandFinalRounds = buildVisualBracket(matches, "grand_final");

  const hasBracket = upperRounds.length > 0;
  const hasLower = lowerRounds.length > 0;
  const hasGrandFinal = grandFinalRounds.length > 0;
  const isMultiSection = hasLower || hasGrandFinal;

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-[1400px] mx-auto">
      {pageHeader}

      {!hasBracket && (
        <p className="text-sm text-muted-foreground">{tl("page.bracketEmpty")}</p>
      )}

      {hasBracket && (
        <section className="space-y-1">
          {isMultiSection && (
            <h2 className="text-sm font-semibold text-muted-foreground mb-4">{tl("page.bracketUpper")}</h2>
          )}
          <BracketView rounds={upperRounds} competitorById={competitorMap} unit={unit} />
        </section>
      )}

      {hasLower && (
        <>
          <Separator className="my-8" />
          <section className="space-y-1">
            <h2 className="text-sm font-semibold text-muted-foreground mb-4">{tl("page.bracketLower")}</h2>
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
