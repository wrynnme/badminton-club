import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EditProfileForm } from "@/components/profile/edit-profile-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/?auth_error=login_required&redirectTo=/profile");

  const t = await getTranslations("settings");

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">{t("profileSection")}</h1>

      <Card>
        <CardContent className="space-y-5 pt-6">
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
    </div>
  );
}
