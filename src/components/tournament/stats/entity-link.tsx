"use client";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Renders an inline link to the per-entity stats page for the current
 * tournament. Resolves the tournament context from the route segment params:
 *
 *   /tournaments/[id]/...  → params.id    → `/tournaments/<id>/stats/<type>/<entityId>`
 *   /t/[token]/...         → params.token → `/t/<token>/stats/<type>/<entityId>`
 *
 * Behavior notes:
 *  - Guarded by pathname prefix (`/tournaments/` or `/t/`) — being inside an
 *    unrelated route that happens to also expose an `id` / `token` param will
 *    NOT generate a stats href (children render unwrapped). This avoids
 *    accidentally producing broken links from co-incident param names.
 *  - When the current pathname is already the stats page for the same entity,
 *    renders children unwrapped (no self-link).
 *  - Caller responsibility: do NOT pass `entityType="division"` when the
 *    tournament has no division thresholds configured — the resulting page
 *    will 404. Gate division links on `thresholds.length > 0` at the callsite.
 */
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
  const params = useParams<{ id?: string; token?: string }>();

  // Guard: no id → render unwrapped
  if (!entityId) return <>{children}</>;

  // Self-link guard: if the current page IS this entity's stats page, render
  // children unwrapped (no recursive same-page link).
  const selfSuffix = `/stats/${entityType}/${encodeURIComponent(entityId)}`;
  if (pathname && pathname.endsWith(selfSuffix)) return <>{children}</>;

  // Pathname-prefix gate: ensure we're actually inside a tournament/share route
  // before trusting params.id / params.token (other routes may co-incidentally
  // expose the same param names).
  let href: string | null = null;
  if (pathname?.startsWith("/tournaments/") && params.id) {
    href = `/tournaments/${params.id}/stats/${entityType}/${encodeURIComponent(entityId)}`;
  } else if (pathname?.startsWith("/t/") && params.token) {
    href = `/t/${params.token}/stats/${entityType}/${encodeURIComponent(entityId)}`;
  }

  if (!href) return <>{children}</>;
  return (
    <Link href={href} className={`hover:underline ${className ?? ""}`}>
      {children}
    </Link>
  );
}
