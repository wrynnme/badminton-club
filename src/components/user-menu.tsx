"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { User, Users, Trophy, Settings, LogOut, ChevronDown } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Desktop account dropdown anchored to the avatar + name in SiteHeader.
 * Built on the same Popover primitive the mobile nav uses (no extra dep).
 * Session data is passed as plain props so SiteHeader stays a server component.
 * Logout is a native <form> POST so it works without client JS.
 */
export function UserMenu({
  displayName,
  pictureUrl,
  isGuest,
}: {
  displayName: string;
  pictureUrl?: string | null;
  isGuest: boolean;
}) {
  const t = useTranslations("nav");

  const items = [
    { href: "/settings", label: t("profile"), icon: User },
    { href: "/clubs", label: t("myClub"), icon: Users },
    { href: "/tournaments", label: t("myTournament"), icon: Trophy },
    { href: "/settings", label: t("settings"), icon: Settings },
  ];

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" className="flex items-center gap-2 px-1.5">
            <Avatar className="h-7 w-7">
              {pictureUrl && <AvatarImage src={pictureUrl} />}
              <AvatarFallback>{displayName.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <span className="max-w-[8rem] truncate text-sm">{displayName}</span>
            {isGuest && <Badge variant="secondary">{t("guest")}</Badge>}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-52 p-1">
        {items.map(({ href, label, icon: Icon }, i) => (
          <Link
            key={i}
            href={href}
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent"
          >
            <Icon className="h-4 w-4 text-muted-foreground" />
            {label}
          </Link>
        ))}
        <div className="my-1 h-px bg-border" />
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-destructive transition-colors hover:bg-accent"
          >
            <LogOut className="h-4 w-4" />
            {t("logout")}
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
