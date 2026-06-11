import Link from "next/link";
import { Trophy, MapPin, CalendarDays, GitBranch, Tv } from "lucide-react";
import { format } from "date-fns";
import { th } from "date-fns/locale";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Tournament, TeamWithPlayers, Match } from "@/lib/types";

function StatBlock({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border bg-card/60 backdrop-blur-sm px-3 py-2.5 space-y-0.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
        {label}
      </div>
      <div className="text-lg sm:text-xl font-bold tabular-nums leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export async function PublicHero({
  tournament: tour,
  token,
  teams,
  allMatches,
  showBracketLink,
}: {
  tournament: Tournament;
  token: string;
  teams: TeamWithPlayers[];
  allMatches: Match[];
  showBracketLink: boolean;
}) {
  const t = await getTranslations("tournament");

  const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
    draft: {
      label: t("publicHero.statusDraft"),
      cls: "bg-muted text-muted-foreground",
    },
    registering: {
      label: t("publicHero.statusRegistering"),
      cls: "bg-warning/15 text-warning",
    },
    ongoing: {
      label: t("publicHero.statusOngoing"),
      cls: "bg-success/15 text-success",
    },
    completed: {
      label: t("publicHero.statusCompleted"),
      cls: "bg-foreground/10 text-foreground",
    },
  };

  const FORMAT_LABEL: Record<string, string> = {
    group_only: t("publicHero.formatGroupOnly"),
    group_knockout: t("publicHero.formatGroupKnockout"),
    knockout_only: t("publicHero.formatKnockoutOnly"),
  };

  const status = STATUS_STYLE[tour.status] ?? STATUS_STYLE.draft;
  const totalMatches = allMatches.length;
  const completedMatches = allMatches.filter((m) => m.status === "completed").length;
  const matchesDisplay =
    totalMatches === 0 ? "—" : `${completedMatches}/${totalMatches}`;

  return (
    <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/8 via-background to-brand/8">
      {/* Champion accent stripe */}
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-live to-brand" />
      {/* Decorative bg trophy */}
      <Trophy className="absolute -right-8 -top-8 size-56 text-brand/[0.05] rotate-12 pointer-events-none select-none" />

      <div className="relative p-5 sm:p-7 space-y-4 sm:space-y-5">
        {/* Title + TV button */}
        <div className="flex items-start justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Trophy className="h-8 w-8 sm:h-10 sm:w-10 shrink-0 text-brand" />
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight leading-tight truncate">
              {tour.name}
            </h1>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <ThemeToggle />
            <Button
              render={<Link href={`/t/${token}/tv`} />}
              nativeButton={false}
              size="sm"
              variant="secondary"
              className="shrink-0"
            >
              <Tv className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">TV</span>
            </Button>
          </div>
        </div>

        {/* Status pill + meta */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.cls}`}
          >
            {status.label}
          </span>
          {tour.venue && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {tour.venue}
            </span>
          )}
          {tour.start_date && (
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              {format(new Date(tour.start_date), "d MMM yyyy", { locale: th })}
              {tour.end_date &&
                tour.end_date !== tour.start_date &&
                ` – ${format(new Date(tour.end_date), "d MMM yyyy", { locale: th })}`}
            </span>
          )}
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <StatBlock label={t("publicHero.labelFormat")} value={FORMAT_LABEL[tour.format] ?? tour.format} />
          <StatBlock
            label={t("publicHero.labelTeams")}
            value={String(tour.team_count ?? teams.length)}
          />
          <StatBlock
            label={t("publicHero.labelCompetitors")}
            value={tour.match_unit === "pair" ? t("publicHero.unitPairVsPair") : t("publicHero.unitTeamVsTeam")}
          />
          <StatBlock
            label={t("publicHero.labelMatches")}
            value={matchesDisplay}
            sub={totalMatches > 0 ? t("publicHero.matchesSub") : undefined}
          />
        </div>

        {/* Action row */}
        <div className="flex items-center gap-2 flex-wrap pt-1">
          {showBracketLink && (
            <Button
              render={<Link href={`/tournaments/${tour.id}/bracket`} />}
              nativeButton={false}
              size="sm"
              variant="outline"
            >
              <GitBranch className="h-3.5 w-3.5" />
              {t("publicHero.viewBracket")}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
