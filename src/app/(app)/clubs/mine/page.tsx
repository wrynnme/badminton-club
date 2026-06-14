import Link from "next/link";
import { format } from "date-fns";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { getTranslations, getLocale } from "next-intl/server";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";
import { PresetManager } from "@/components/club/preset-manager";
import { listClubPresetsAction } from "@/lib/actions/club-presets";
import type { ClubPreset } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MyClubsPage() {
  const sb = await createAdminClient();
  const session = await getSession();
  const canCreate = !!session && !session.isGuest;

  type ClubRow = {
    id: string;
    name: string;
    venue: string;
    play_date: string;
    start_time: string;
    end_time: string;
    max_players: number;
  };
  let clubs: ClubRow[] = [];
  if (session && !session.isGuest) {
    const { data: adminRows } = await sb
      .from("club_admins")
      .select("club_id")
      .eq("user_id", session.profileId);
    const adminClubIds = (adminRows ?? []).map((r) => r.club_id);
    const orFilter = [`owner_id.eq.${session.profileId}`];
    if (adminClubIds.length) orFilter.push(`id.in.(${adminClubIds.join(",")})`);
    const { data } = await sb
      .from("clubs")
      .select("id, name, venue, play_date, start_time, end_time, max_players")
      .or(orFilter.join(","))
      .order("play_date", { ascending: false });
    clubs = (data ?? []) as ClubRow[];
  }

  const clubIds = clubs.map((c) => c.id);
  const countMap = new Map<string, number>();
  if (clubIds.length) {
    const { data: counts } = await sb
      .from("club_players")
      .select("club_id")
      .in("club_id", clubIds);
    for (const r of counts ?? []) {
      countMap.set(r.club_id, (countMap.get(r.club_id) ?? 0) + 1);
    }
  }

  let presets: ClubPreset[] = [];
  if (canCreate) {
    const presetsResult = await listClubPresetsAction();
    if ("presets" in presetsResult) presets = presetsResult.presets;
  }

  const locale = await getLocale();
  const t = await getTranslations("club");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("page.myListHeading")}</h1>
        {canCreate && (
          <Link href="/clubs/new">
            <Button>{t("page.createButton")}</Button>
          </Link>
        )}
      </div>

      {!clubs.length ? (
        <p className="text-muted-foreground">
          {canCreate ? t("page.emptyWithCreate") : t("page.emptyNoCreate")}
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clubs.map((c) => {
            const joined = countMap.get(c.id) ?? 0;
            const full = joined >= c.max_players;
            return (
              <Link key={c.id} href={`/clubs/${c.id}`}>
                <Card className="hover:shadow-md transition">
                  <CardHeader>
                    <CardTitle className="flex items-start justify-between gap-2">
                      <span className="line-clamp-1">{c.name}</span>
                      {full ? (
                        <Badge variant="destructive">{t("page.full")}</Badge>
                      ) : (
                        <Badge variant="secondary">{joined}/{c.max_players}</Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      <span className="line-clamp-1">{c.venue}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4" />
                      <span>
                        {format(new Date(c.play_date), "d MMM", { locale: dateFnsLocaleOf(locale) })} {c.start_time.slice(0, 5)}–{c.end_time.slice(0, 5)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      <span>{t("page.playerCountCard", { joined, max: c.max_players })}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {canCreate && <PresetManager presets={presets} />}
    </div>
  );
}
