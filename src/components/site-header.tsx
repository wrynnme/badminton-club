import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BrandLogo } from "@/components/brand-logo";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { UserMenu } from "@/components/user-menu";
import { MobileNav } from "@/components/mobile-nav";

export async function SiteHeader() {
  const session = await getSession();
  const t = await getTranslations("nav");
  return (
    <header className="border-b">
      <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/" className="font-bold text-lg flex items-center gap-2">
            <BrandLogo className="h-7 w-auto" priority />
            <span>{t("brand")}</span>
          </Link>
          <Link href="/whats-new" aria-label={t("whatsNew")}>
            <Badge variant="outline" className="text-xs font-mono font-normal hidden sm:inline-flex">
              v{process.env.NEXT_PUBLIC_APP_VERSION}
            </Badge>
          </Link>
        </div>
        <nav className="hidden sm:flex items-center gap-2">
          <Link href="/clubs">
            <Button variant="ghost" size="sm">{t("clubs")}</Button>
          </Link>
          <Link href="/tournaments">
            <Button variant="ghost" size="sm">{t("tournaments")}</Button>
          </Link>
          {session ? (
            <>
              {!session.isGuest && (
                <Link href="/clubs/new">
                  <Button size="sm">{t("createClub")}</Button>
                </Link>
              )}
              <UserMenu
                displayName={session.displayName}
                pictureUrl={session.pictureUrl}
                isGuest={session.isGuest}
              />
            </>
          ) : (
            <>
              <LocaleSwitcher />
              <ThemeToggle />
              <Link href="/">
                <Button size="sm">{t("login")}</Button>
              </Link>
            </>
          )}
        </nav>
        <div className="flex sm:hidden items-center gap-1">
          <LocaleSwitcher />
          <ThemeToggle />
          {session && (
            <Link href="/settings" aria-label={t("accountSettings")}>
              <Avatar className="h-8 w-8">
                {session.pictureUrl && <AvatarImage src={session.pictureUrl} />}
                <AvatarFallback>{session.displayName.slice(0, 1)}</AvatarFallback>
              </Avatar>
            </Link>
          )}
          <MobileNav
            loggedIn={!!session}
            isGuest={session?.isGuest ?? false}
            displayName={session?.displayName}
          />
        </div>
      </div>
    </header>
  );
}
