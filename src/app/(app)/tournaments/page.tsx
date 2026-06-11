import Link from "next/link";
import { format } from "date-fns";
import { th } from "date-fns/locale";
import { Trophy, Plus } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TOURNAMENT_STATUS_BADGE, TOURNAMENT_STATUS_LABEL } from "@/lib/tournament/status";
import { getTranslations } from "next-intl/server";
import type { Tournament } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TournamentsPage() {
  const sb = await createAdminClient();
  const session = await getSession();

  const { data: tournaments } = await sb
    .from("tournaments")
    .select("*")
    .order("created_at", { ascending: false });

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
          <h1 className="text-2xl font-bold">{t("page.listHeading")}</h1>
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

      {!tournaments?.length ? (
        <div className="text-center py-16 text-muted-foreground space-y-3">
          <Trophy className="h-12 w-12 mx-auto opacity-20" />
          <p>{t("page.listEmpty")}</p>
          {session && !session.isGuest && (
            <Link href="/tournaments/new">
              <Button variant="outline">{t("page.listCreateFirst")}</Button>
            </Link>
          )}
          {session?.isGuest && (
            <p className="text-xs">{t("page.listGuestHint")}</p>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(tournaments as Tournament[]).map((tournament) => {
            return (
              <Link key={tournament.id} href={`/tournaments/${tournament.id}`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-snug">{tournament.name}</CardTitle>
                      <Badge variant={TOURNAMENT_STATUS_BADGE[tournament.status]} className="shrink-0">
                        {TOURNAMENT_STATUS_LABEL[tournament.status]}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground space-y-1">
                    {tournament.venue && <p>📍 {tournament.venue}</p>}
                    {tournament.start_date && (
                      <p>📅 {format(new Date(tournament.start_date), "d MMM yyyy", { locale: th })}</p>
                    )}
                    <p>🏆 {formatLabel[tournament.format]} · {t("page.listTeamCount", { count: tournament.team_count })}</p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
