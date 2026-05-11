import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export async function SiteHeader() {
  const session = await getSession();
  return (
    <header className="border-b">
      <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg">
          🏸 ก๊วนแบด
        </Link>
        <nav className="flex items-center gap-3">
          <Link href="/clubs" className="text-sm hover:underline">
            ก๊วนทั้งหมด
          </Link>
          {session ? (
            <>
              <Link href="/clubs/new">
                <Button size="sm">สร้างก๊วน</Button>
              </Link>
              <div className="flex items-center gap-2">
                <Avatar className="h-8 w-8">
                  {session.pictureUrl && <AvatarImage src={session.pictureUrl} />}
                  <AvatarFallback>{session.displayName.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <span className="text-sm hidden sm:inline">{session.displayName}</span>
                {session.isGuest && <Badge variant="secondary">guest</Badge>}
              </div>
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
      </div>
    </header>
  );
}
