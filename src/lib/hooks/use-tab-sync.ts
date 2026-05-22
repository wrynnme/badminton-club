"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Syncs a tab selection with the ?tab= URL query parameter.
 *
 * - Reads the active tab from ?tab=; falls back to defaultTab when the param
 *   is absent, not in allTabs, or not in validTabs (currently-visible tabs).
 * - Strips an invalid ?tab= synchronously before paint via useLayoutEffect so
 *   the stale param is never visible for even one frame.
 * - Lazy-mounts: tracks which tabs have been visited so callers can defer
 *   rendering tab content until first visit.
 * - onChange writes ?tab=next (or strips the param when next === defaultTab)
 *   so the canonical default URL stays clean.
 *
 * Note: useLayoutEffect does not run on the server — that is intentional
 * because ?tab= is client-only URL state.
 */
export function useTabSync<T extends string>(opts: {
  /** Exhaustive list of every possible tab ID (including conditionally hidden ones). */
  allTabs: readonly T[];
  /** Tabs that are currently visible to this viewer. */
  validTabs: readonly T[];
  /** Canonical landing tab — ?tab= is stripped when active === defaultTab. */
  defaultTab: T;
}): { active: T; mounted: Set<T>; onChange: (next: string) => void } {
  const { allTabs, validTabs, defaultTab } = opts;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const queryTab = searchParams.get("tab") as T | null;

  // Derive active tab: must be known (allTabs) AND currently visible (validTabs).
  const active = useMemo<T>(() => {
    if (queryTab && allTabs.includes(queryTab) && validTabs.includes(queryTab)) {
      return queryTab;
    }
    return defaultTab;
  }, [queryTab, allTabs, validTabs, defaultTab]);

  // Lazy-mount tracking: seed with initial active tab; grow on navigation.
  const [mounted, setMounted] = useState<Set<T>>(() => new Set<T>([active]));
  // Use a layout effect so the Set update is synchronous before paint.
  useLayoutEffect(() => {
    setMounted((prev) => (prev.has(active) ? prev : new Set([...prev, active])));
  }, [active]);

  // Strip invalid ?tab= synchronously before paint so the URL always matches
  // the actually-rendered tab from the very first frame.
  const searchString = searchParams.toString();
  useLayoutEffect(() => {
    if (queryTab && (!allTabs.includes(queryTab) || !validTabs.includes(queryTab))) {
      const params = new URLSearchParams(searchString);
      params.delete("tab");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [queryTab, allTabs, validTabs, router, pathname, searchString]);

  const onChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === defaultTab) {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return { active, mounted, onChange };
}
