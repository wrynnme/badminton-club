import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/?auth_error=login_required&redirectTo=/settings");

  const t = await getTranslations("settings");

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">{t("title")}</h1>

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
