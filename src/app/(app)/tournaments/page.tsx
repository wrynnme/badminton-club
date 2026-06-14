import Link from "next/link";
import { Trophy, Plus } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getTranslations } from "next-intl/server";
import { TournamentCard } from "@/components/tournament/tournament-card";
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
          {session?.isGuest && <p className="text-xs">{t("page.listGuestHint")}</p>}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(tournaments as Tournament[]).map((tournament) => (
            <TournamentCard key={tournament.id} tournament={tournament} />
          ))}
        </div>
      )}
    </div>
  );
}
