import Link from "next/link";
import { format } from "date-fns";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dateFnsLocaleOf } from "@/i18n/date-fns-locale";

export type ClubCardData = {
  id: string;
  name: string;
  venue: string;
  play_date: string;
  start_time: string;
  end_time: string;
  max_players: number;
};

/** Club summary card shared by `/clubs` and `/clubs/mine`. */
export async function ClubCard({ club, joined }: { club: ClubCardData; joined: number }) {
  const t = await getTranslations("club");
  const locale = await getLocale();
  const full = joined >= club.max_players;

  return (
    <Link href={`/clubs/${club.id}`}>
      <Card className="hover:shadow-md transition">
        <CardHeader>
          <CardTitle className="flex items-start justify-between gap-2">
            <span className="line-clamp-1">{club.name}</span>
            {full ? (
              <Badge variant="destructive">{t("page.full")}</Badge>
            ) : (
              <Badge variant="secondary">{joined}/{club.max_players}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            <span className="line-clamp-1">{club.venue}</span>
          </div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            <span>
              {format(new Date(club.play_date), "d MMM", { locale: dateFnsLocaleOf(locale) })} {club.start_time.slice(0, 5)}–{club.end_time.slice(0, 5)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span>{t("page.playerCountCard", { joined, max: club.max_players })}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
