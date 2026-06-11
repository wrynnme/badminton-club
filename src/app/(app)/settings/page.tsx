import Link from "next/link";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EditProfileForm } from "@/components/profile/edit-profile-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/?auth_error=login_required&redirectTo=/settings");

  const t = await getTranslations("settings");

  // Owner-only past clubs (play_date already passed) — the /clubs list shows only
  // today/upcoming (play_date >= today), so expired clubs we own live here as history.
  // Guests can't own clubs, so skip the query for them.
  let pastClubs: { id: string; name: string; venue: string; play_date: string }[] = [];
  if (!session.isGuest) {
    const sb = await createAdminClient();
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await sb
      .from("clubs")
      .select("id, name, venue, play_date")
      .eq("owner_id", session.profileId)
      .lt("play_date", today)
      .order("play_date", { ascending: false });
    pastClubs = data ?? [];
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">{t("title")}</h1>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("profileSection")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar className="h-14 w-14">
              {session.pictureUrl && <AvatarImage src={session.pictureUrl} />}
              <AvatarFallback className="text-lg">{session.displayName.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <p className="font-medium">{session.displayName}</p>
              <Badge variant={session.isGuest ? "secondary" : "outline"}>
                {session.isGuest ? "guest" : "LINE"}
              </Badge>
            </div>
          </div>
          <EditProfileForm displayName={session.displayName} />
        </CardContent>
      </Card>

      {!session.isGuest && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("pastClubsSection")}</CardTitle>
          </CardHeader>
          <CardContent>
            {pastClubs.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("pastClubsEmpty")}</p>
            ) : (
              <ul className="space-y-2">
                {pastClubs.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/clubs/${c.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted/50"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">{c.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{c.venue}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {format(new Date(c.play_date), "d MMM yyyy")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("accountSection")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <form action="/api/auth/logout" method="post">
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" type="submit">{t("logout")}</Button>} />
              <TooltipContent>{t("logoutTooltip")}</TooltipContent>
            </Tooltip>
          </form>
          <form action="/api/auth/logout-all" method="post">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="outline" type="submit" className="text-destructive hover:text-destructive">
                    {t("logoutAll")}
                  </Button>
                }
              />
              <TooltipContent>{t("logoutAllTooltip")}</TooltipContent>
            </Tooltip>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
