import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { MobileNav } from "@/components/mobile-nav";

export async function SiteHeader() {
  const session = await getSession();
  return (
    <header className="border-b">
      <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg flex items-center gap-2">
          🏸 ก๊วนแบด
          <Badge variant="outline" className="text-xs font-mono font-normal hidden sm:inline-flex">
            v{process.env.NEXT_PUBLIC_APP_VERSION} ({process.env.NEXT_PUBLIC_GIT_COMMIT})
          </Badge>
        </Link>
        <nav className="hidden sm:flex items-center gap-3">
          <ThemeToggle />
          <Link href="/clubs" className="text-sm hover:underline">
            ก๊วน
          </Link>
          <Link href="/tournaments" className="text-sm hover:underline">
            ทัวร์นาเมนต์
          </Link>
          {session ? (
            <>
              {!session.isGuest && (
                <Link href="/clubs/new">
                  <Button size="sm">สร้างก๊วน</Button>
                </Link>
              )}
              <Link href="/settings" className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-accent transition-colors" title="ตั้งค่าบัญชี">
                <Avatar className="h-8 w-8">
                  {session.pictureUrl && <AvatarImage src={session.pictureUrl} />}
                  <AvatarFallback>{session.displayName.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <span className="text-sm hidden sm:inline">{session.displayName}</span>
                {session.isGuest && <Badge variant="secondary">guest</Badge>}
              </Link>
              <form action="/api/auth/logout" method="post">
                <Button variant="ghost" size="sm" type="submit">
                  ออก
                </Button>
              </form>
            </>
          ) : (
            <Link href="/">
              <Button size="sm">เข้าสู่ระบบ</Button>
            </Link>
          )}
        </nav>
        <div className="flex sm:hidden items-center gap-1">
          <ThemeToggle />
          {session && (
            <Link href="/settings" aria-label="ตั้งค่าบัญชี">
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
