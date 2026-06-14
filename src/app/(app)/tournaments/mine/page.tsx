import Link from "next/link";
import { format } from "date-fns";
import { Trophy, Plus } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TOURNAMENT_STATUS_BADGE } from "@/lib/tournament/status";
import { getTranslations, getLocale } from "next-intl/server";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";
import type { Tournament } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MyTournamentsPage() {
  const sb = await createAdminClient();
  const session = await getSession();

  let tournaments: Tournament[] = [];
  if (session && !session.isGuest) {
    const { data: adminRows } = await sb
      .from("tournament_admins")
      .select("tournament_id")
      .eq("user_id", session.profileId);
    const adminTournamentIds = (adminRows ?? []).map((r) => r.tournament_id);
    const orFilter = [`owner_id.eq.${session.profileId}`];
    if (adminTournamentIds.length)
      orFilter.push(`id.in.(${adminTournamentIds.join(",")})`);
    const { data } = await sb
      .from("tournaments")
      .select("*")
      .or(orFilter.join(","))
      .order("created_at", { ascending: false });
    tournaments = (data ?? []) as Tournament[];
  }

  const locale = await getLocale();
  const t = await getTranslations("tournament");

  const formatLabel: Record<string, string> = {
    group_only: t("page.formatGroupOnly"),
    group_knockout: t("page.formatGroupKnockout"),
    knockout_only: t("page.formatKnockoutOnly"),
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-6 w-6" />
          <h1 className="text-2xl font-bold">{t("page.myListHeading")}</h1>
        </div>
        {session && !session.isGuest && (
          <Link href="/tournaments/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              {t("page.listCreateButton")}
            </Button>
          </Link>
        )}
      </div>

      {!tournaments.length ? (
        <div className="text-center py-16 text-muted-foreground space-y-3">
          <Trophy className="h-12 w-12 mx-auto opacity-20" />
          <p>{t("page.myListEmpty")}</p>
          {session && !session.isGuest && (
            <Link href="/tournaments/new">
              <Button variant="outline">{t("page.listCreateFirst")}</Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {tournaments.map((tournament) => (
            <Link key={tournament.id} href={`/tournaments/${tournament.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-snug">{tournament.name}</CardTitle>
                    <Badge variant={TOURNAMENT_STATUS_BADGE[tournament.status]} className="shrink-0">
                      {t(`tournamentStatus.${tournament.status}`)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-1">
                  {tournament.venue && <p>📍 {tournament.venue}</p>}
                  {tournament.start_date && (
                    <p>📅 {format(new Date(tournament.start_date), "d MMM yyyy", { locale: dateFnsLocaleOf(locale) })}</p>
                  )}
                  <p>🏆 {formatLabel[tournament.format]} · {t("page.listTeamCount", { count: tournament.team_count })}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
