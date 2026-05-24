"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useProgress } from "@bprogress/next";

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

  // Lazy-mount tracking: seed with both active AND defaultTab so the default
  // tab's content is never null on first render even when ?tab= points elsewhere.
  const [mounted, setMounted] = useState<Set<T>>(
    () => new Set<T>([active, defaultTab])
  );
  // Use a layout effect so the Set update is synchronous before paint.
  useLayoutEffect(() => {
    setMounted((prev) => (prev.has(active) ? prev : new Set([...prev, active])));
  }, [active]);

  // Strip invalid ?tab= synchronously before paint so the URL always matches
  // the actually-rendered tab from the very first frame.
  // strippedRef guards against firing router.replace twice when an unrelated
  // parent re-render changes searchString while the same invalid queryTab is
  // still present — prevents double history entries.
  const strippedRef = useRef<string | null>(null);
  const searchString = searchParams.toString();
  useLayoutEffect(() => {
    if (!queryTab) {
      strippedRef.current = null;
      return;
    }
    if (allTabs.includes(queryTab) && validTabs.includes(queryTab)) return;
    if (strippedRef.current === queryTab) return; // already stripped this one
    strippedRef.current = queryTab;
    const params = new URLSearchParams(searchString);
    params.delete("tab");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [queryTab, allTabs, validTabs, router, pathname, searchString]);

  // Tab change triggers a router.replace; wrap it in startTransition so we can
  // observe pending state via React, then drive the global @bprogress bar.
  // This makes the top progress bar visible while the new tab's content
  // (lazy chunks, Suspense boundaries) resolves.
  const progress = useProgress();
  const [isPending, startTransition] = useTransition();
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isPending && startedRef.current) {
      progress.stop();
      startedRef.current = false;
    }
  }, [isPending, progress]);

  const onChange = (next: string) => {
    // No-op when clicking the already-active tab: skip router.replace + progress bar.
    // Without this guard, same-tab clicks fire startTransition with an identical URL —
    // useTransition stays pending (no work to do, no commit), so the cleanup effect
    // never fires and the @bprogress bar hangs at the top of the page.
    if (next === active) return;

    const params = new URLSearchParams(searchParams.toString());
    if (next === defaultTab) {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const qs = params.toString();
    progress.start();
    startedRef.current = true;
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  return { active, mounted, onChange };
}
