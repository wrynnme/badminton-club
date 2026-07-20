import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
          {/* Flow Step 3 (2026-07-21): tell first-timers what this form actually
              produces — a permanent ก๊วน AND its first รอบตี in one go. */}
          <CardDescription>{t("page.newClubExplainer")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateSeriesForm />
        </CardContent>
      </Card>
    </div>
  );
}
