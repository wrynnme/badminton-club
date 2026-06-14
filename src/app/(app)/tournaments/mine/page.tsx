import Link from "next/link";
import { Trophy, Plus } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getTranslations } from "next-intl/server";
import { TournamentCard } from "@/components/tournament/tournament-card";
import { ownerOrAdminOrFilter } from "@/lib/owner-scope";
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
    const { data } = await sb
      .from("tournaments")
      .select("*")
      .or(ownerOrAdminOrFilter(session.profileId, adminTournamentIds))
      .order("created_at", { ascending: false });
    tournaments = (data ?? []) as Tournament[];
  }

  const t = await getTranslations("tournament");

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
            <TournamentCard key={tournament.id} tournament={tournament} />
          ))}
        </div>
      )}
    </div>
  );
}
