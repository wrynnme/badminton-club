import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getTranslations } from "next-intl/server";
import { ClubCard, type ClubCardData } from "@/components/club/club-card";
import { ownerOrAdminOrFilter } from "@/lib/owner-scope";

export const dynamic = "force-dynamic";

export default async function ClubsPage() {
  const sb = await createAdminClient();
  const session = await getSession();
  const canCreate = !!session && !session.isGuest;
  const today = new Date().toISOString().slice(0, 10);

  // Clubs are owner/co-admin only — list only the clubs this user owns or co-admins.
  let clubs: ClubCardData[] = [];
  if (session) {
    const { data: adminRows } = await sb
      .from("club_admins")
      .select("club_id")
      .eq("user_id", session.profileId);
    const adminClubIds = (adminRows ?? []).map((r) => r.club_id);
    const { data } = await sb
      .from("clubs")
      .select("id, name, venue, play_date, start_time, end_time, max_players")
      .gte("play_date", today)
      .or(ownerOrAdminOrFilter(session.profileId, adminClubIds))
      .order("play_date", { ascending: true });
    clubs = (data ?? []) as ClubCardData[];
  }

  const { data: counts } = await sb.from("club_players").select("club_id");
  const countMap = new Map<string, number>();
  for (const r of counts ?? []) {
    countMap.set(r.club_id, (countMap.get(r.club_id) ?? 0) + 1);
  }

  const t = await getTranslations("club");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("page.listHeading")}</h1>
        {canCreate && (
          <Link href="/clubs/new">
            <Button>{t("page.createButton")}</Button>
          </Link>
        )}
      </div>

      {session?.isGuest && (
        <p className="text-xs text-muted-foreground">{t("page.guestHint")}</p>
      )}

      {!clubs?.length ? (
        <p className="text-muted-foreground">
          {canCreate ? t("page.emptyWithCreate") : t("page.emptyNoCreate")}
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clubs.map((c) => (
            <ClubCard key={c.id} club={c} joined={countMap.get(c.id) ?? 0} />
          ))}
        </div>
      )}
    </div>
  );
}
