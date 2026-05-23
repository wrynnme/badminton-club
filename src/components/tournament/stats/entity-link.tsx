"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function EntityLink({
  entityType,
  entityId,
  className,
  children,
}: {
  entityType: "pair" | "team" | "player" | "division";
  entityId: string | null | undefined;
  className?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();

  // Guard: no id → render unwrapped
  if (!entityId) return <>{children}</>;

  // Derive base from current pathname:
  //   /tournaments/<id>/... → /tournaments/<id>/stats/<type>/<entityId>
  //   /t/<token>/...        → /t/<token>/stats/<type>/<entityId>
  // Fallback: if pathname doesn't match either, render children unwrapped.
  let href: string | null = null;
  const adminMatch = pathname.match(/^\/tournaments\/([^/]+)/);
  const publicMatch = pathname.match(/^\/t\/([^/]+)/);
  if (adminMatch) {
    href = `/tournaments/${adminMatch[1]}/stats/${entityType}/${encodeURIComponent(entityId)}`;
  } else if (publicMatch) {
    href = `/t/${publicMatch[1]}/stats/${entityType}/${encodeURIComponent(entityId)}`;
  }

  if (!href) return <>{children}</>;
  return (
    <Link href={href} className={`hover:underline ${className ?? ""}`}>
      {children}
    </Link>
  );
}
