import Link from "next/link";
import { Trophy, MapPin, CalendarDays, GitBranch, Tv } from "lucide-react";
import { format } from "date-fns";
import { th } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { ExportButtons } from "@/components/tournament/export-buttons";
import type { Tournament, TeamWithPlayers, PairWithPlayers, Match } from "@/lib/types";

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  draft: {
    label: "แบบร่าง",
    cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  },
  registering: {
    label: "เปิดรับสมัคร",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  },
  ongoing: {
    label: "กำลังแข่ง",
    cls: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  },
  completed: {
    label: "จบแล้ว",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
};

const FORMAT_LABEL: Record<string, string> = {
  group_only: "แบ่งกลุ่ม",
  group_knockout: "กลุ่ม + สาย",
  knockout_only: "สายเดียว",
};

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

export function PublicHero({
  tournament: t,
  token,
  teams,
  pairs,
  allMatches,
  showBracketLink,
}: {
  tournament: Tournament;
  token: string;
  teams: TeamWithPlayers[];
  pairs: PairWithPlayers[];
  allMatches: Match[];
  showBracketLink: boolean;
}) {
  const status = STATUS_STYLE[t.status] ?? STATUS_STYLE.draft;
  const totalMatches = allMatches.length;
  const completedMatches = allMatches.filter((m) => m.status === "completed").length;
  const matchesDisplay =
    totalMatches === 0 ? "—" : `${completedMatches}/${totalMatches}`;

  return (
    <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-amber-50 via-background to-orange-50 dark:from-amber-950/30 dark:via-background dark:to-orange-950/20">
      {/* Champion accent stripe */}
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-400 via-yellow-500 to-orange-500" />
      {/* Decorative bg trophy */}
      <Trophy className="absolute -right-8 -top-8 size-56 text-amber-500/[0.04] dark:text-amber-300/[0.04] rotate-12 pointer-events-none select-none" />

      <div className="relative p-5 sm:p-7 space-y-4 sm:space-y-5">
        {/* Title + TV button */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Trophy className="h-8 w-8 sm:h-10 sm:w-10 shrink-0 text-amber-500" />
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight leading-tight truncate">
              {t.name}
            </h1>
          </div>
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

        {/* Status pill + meta */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.cls}`}
          >
            {status.label}
          </span>
          {t.venue && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {t.venue}
            </span>
          )}
          {t.start_date && (
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              {format(new Date(t.start_date), "d MMM yyyy", { locale: th })}
              {t.end_date &&
                t.end_date !== t.start_date &&
                ` – ${format(new Date(t.end_date), "d MMM yyyy", { locale: th })}`}
            </span>
          )}
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <StatBlock label="รูปแบบ" value={FORMAT_LABEL[t.format] ?? t.format} />
          <StatBlock
            label="ทีม"
            value={String(t.team_count ?? teams.length)}
          />
          <StatBlock
            label="คู่แข่ง"
            value={t.match_unit === "pair" ? "คู่ vs คู่" : "ทีม vs ทีม"}
          />
          <StatBlock
            label="การแข่งขัน"
            value={matchesDisplay}
            sub={totalMatches > 0 ? "จบแล้ว / ทั้งหมด" : undefined}
          />
        </div>

        {/* Action row */}
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <ExportButtons
            tournamentName={t.name}
            tournamentId={t.id}
            matches={allMatches}
            teams={teams}
            pairs={pairs}
            matchUnit={t.match_unit}
          />
          {showBracketLink && (
            <Button
              render={<Link href={`/tournaments/${t.id}/bracket`} />}
              nativeButton={false}
              size="sm"
              variant="outline"
            >
              <GitBranch className="h-3.5 w-3.5" />
              ดูสาย
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
