import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { getSession } from "@/lib/auth/session";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";

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
    name: tAuth("errors.name"),
    login_required: tAuth("errors.login_required"),
    rate_limit: tAuth("errors.rate_limit"),
  };

  return (
    <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto pt-10">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">🏸 {tHome("hero.title")}</h1>
        <p className="text-muted-foreground">
          {tHome("hero.tagline")}
        </p>
        <ul className="text-sm space-y-1 text-muted-foreground list-disc pl-5">
          <li>{tHome("hero.featureCreateClub")}</li>
          <li>{tHome("hero.featureBrowse")}</li>
          <li>{tHome("hero.featureLogin")}</li>
        </ul>
        <Link href="/clubs">
          <Button variant="outline">{tHome("hero.browseAll")}</Button>
        </Link>
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

          <div className="flex items-center gap-2">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">{tAuth("login.or")}</span>
            <Separator className="flex-1" />
          </div>

          <form action="/api/auth/guest" method="post" className="space-y-2">
            {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}
            <Label htmlFor="name">{tAuth("login.guestLabel")}</Label>
            <Input id="name" name="name" placeholder={tAuth("login.guestPlaceholder")} required minLength={2} />
            <Button type="submit" variant="secondary" className="w-full">
              {tAuth("login.guestSubmit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
