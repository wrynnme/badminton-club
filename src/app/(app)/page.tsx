import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/session";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string; redirectTo?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/clubs");

  const sp = await searchParams;
  const redirectTo =
    sp.redirectTo?.startsWith("/") && sp.redirectTo[1] !== "/" && sp.redirectTo[1] !== "\\"
      ? sp.redirectTo
      : undefined;

  const tHome = await getTranslations("home");
  const tAuth = await getTranslations("auth");

  const errorMap: Record<string, string> = {
    state: tAuth("errors.state"),
    token: tAuth("errors.token"),
    profile: tAuth("errors.profile"),
    db: tAuth("errors.db"),
    login_required: tAuth("errors.login_required"),
  };

  return (
    <div className="grid md:grid-cols-2 items-start gap-6 max-w-3xl mx-auto pt-10">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <BrandLogo className="h-9 w-auto" />
          {tHome("hero.title")}
        </h1>
        <p className="text-muted-foreground">
          {tHome("hero.tagline")}
        </p>
        <ul className="text-sm space-y-1 text-muted-foreground list-disc pl-5">
          <li>{tHome("hero.featureCreateClub")}</li>
          <li>{tHome("hero.featureBrowse")}</li>
          <li>{tHome("hero.featureLogin")}</li>
        </ul>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tAuth("login.title")}</CardTitle>
          <CardDescription>{tAuth("login.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sp.auth_error && (
            <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
              {errorMap[sp.auth_error] ?? sp.auth_error}
            </div>
          )}

          <a href={`/api/auth/line${redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ""}`}>
            <Button className="w-full bg-[#06C755] hover:bg-[#05a648] text-white">
              {tAuth("login.withLine")}
            </Button>
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
