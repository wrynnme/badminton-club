"use client";
import React from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Renders an inline link to the per-pair schedule page for the current
 * tournament. Resolves the tournament context from the route segment params:
 *
 *   /tournaments/[id]/...  → params.id    → `/tournaments/<id>/pair/<pairId>`
 *   /t/[token]/...         → params.token → `/t/<token>/pair/<pairId>`
 *
 * Behavior notes:
 *  - Guarded by pathname prefix (`/tournaments/` or `/t/`) — being inside an
 *    unrelated route that happens to also expose an `id` / `token` param will
 *    NOT generate a schedule href (children render unwrapped). This avoids
 *    accidentally producing broken links from co-incident param names.
 *  - When the current pathname EXACTLY equals the resolved href, renders
 *    children unwrapped (no self-link). NOTE: intentionally uses strict
 *    equality (not endsWith) because paths like `/stats/pair/<id>` end with
 *    `/pair/<id>` — endsWith would misfire and kill the cross-link from the
 *    pair-stats page to this schedule page.
 *  - Fallback to plain children when pairId is falsy or no href can be resolved.
 */
export function PairScheduleLink({
  pairId,
  className,
  label,
  children,
}: {
  pairId: string | null | undefined;
  className?: string;
  /** Accessible name for the anchor — required when children are icon-only. */
  label?: string;
  children: ReactNode;
}): React.JSX.Element {
  const pathname = usePathname();
  const params = useParams<{ id?: string; token?: string }>();

  // Guard: no pairId → render unwrapped
  if (!pairId) return <>{children}</>;

  // Pathname-prefix gate: ensure we're actually inside a tournament/share route
  // before trusting params.id / params.token (other routes may co-incidentally
  // expose the same param names).
  let href: string | null = null;
  if (pathname?.startsWith("/tournaments/") && params.id) {
    href = `/tournaments/${params.id}/pair/${encodeURIComponent(pairId)}`;
  } else if (pathname?.startsWith("/t/") && params.token) {
    href = `/t/${params.token}/pair/${encodeURIComponent(pairId)}`;
  }

  if (!href) return <>{children}</>;

  // Self-link guard: exact match only — endsWith would misfire on /stats/pair/<id>
  if (pathname === href) return <>{children}</>;

  return (
    <Link
      href={href}
      className={`hover:underline ${className ?? ""}`}
      aria-label={label}
      title={label}
    >
      {children}
    </Link>
  );
}
