import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/?auth_error=login_required&redirectTo=/settings");

  const t = await getTranslations("settings");
  const siteAdmin = await isSiteAdmin();
  const tAdmin = await getTranslations("admin");

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

      {siteAdmin && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tAdmin("title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/admin" className={`${buttonVariants({ variant: "outline" })} gap-2`} title={tAdmin("qrLogoDesc")}>
              <ShieldCheck className="h-4 w-4" />
              {tAdmin("qrLogoTitle")}
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
