"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Mobile (<sm) condensed nav. The full inline nav in SiteHeader is hidden
 * below `sm`; this hamburger Popover holds the same links + create + logout so
 * the header never overflows on a 360–390px phone. Logout stays a native
 * `<form>` POST (no JS needed). Session data is passed as plain props so the
 * parent SiteHeader can remain a server component.
 */
export function MobileNav({
  loggedIn,
  isGuest,
  displayName,
}: {
  loggedIn: boolean;
  isGuest: boolean;
  displayName?: string;
}) {
  const item =
    "flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-accent transition-colors";
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="เมนู">
            <Menu className="h-5 w-5" />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-52 gap-1 p-2">
        <Link href="/clubs" className={item}>
          ก๊วน
        </Link>
        <Link href="/tournaments" className={item}>
          ทัวร์นาเมนต์
        </Link>
        {loggedIn && !isGuest && (
          <Link href="/clubs/new" className={item}>
            สร้างก๊วน
          </Link>
        )}
        <div className="my-1 border-t" />
        {loggedIn ? (
          <>
            {displayName && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground">
                <span className="truncate">{displayName}</span>
                {isGuest && <Badge variant="secondary">guest</Badge>}
              </div>
            )}
            <Link href="/settings" className={item}>
              ตั้งค่า
            </Link>
            <form action="/api/auth/logout" method="post">
              <Button
                variant="ghost"
                type="submit"
                className="min-h-11 w-full justify-start text-destructive hover:text-destructive"
              >
                ออก
              </Button>
            </form>
          </>
        ) : (
          <Link href="/" className={item}>
            เข้าสู่ระบบ
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}
