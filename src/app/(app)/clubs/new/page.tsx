import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/session";
import { CreateSeriesForm } from "@/components/club/create-series-form";
import { getTranslations } from "next-intl/server";

export default async function NewClubPage() {
  const session = await getSession();
  if (!session) redirect("/?auth_error=login_required");
  if (session.isGuest) redirect("/clubs?auth_error=line_required");

  const t = await getTranslations("club");

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>{t("page.newClubTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateSeriesForm />
        </CardContent>
      </Card>
    </div>
  );
}
