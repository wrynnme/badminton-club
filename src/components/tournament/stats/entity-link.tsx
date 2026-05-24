"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
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
  // Use route params (typed, no regex on pathname).
  //   /tournaments/[id]/... → params.id  → /tournaments/<id>/stats/<type>/<entityId>
  //   /t/[token]/...        → params.token → /t/<token>/stats/<type>/<entityId>
  // Fallback: outside either route group → render children unwrapped.
  const params = useParams<{ id?: string; token?: string }>();

  // Guard: no id → render unwrapped
  if (!entityId) return <>{children}</>;

  let href: string | null = null;
  if (params.id) {
    href = `/tournaments/${params.id}/stats/${entityType}/${encodeURIComponent(entityId)}`;
  } else if (params.token) {
    href = `/t/${params.token}/stats/${entityType}/${encodeURIComponent(entityId)}`;
  }

  if (!href) return <>{children}</>;
  return (
    <Link href={href} className={`hover:underline ${className ?? ""}`}>
      {children}
    </Link>
  );
}
