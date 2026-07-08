"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useProgress } from "@bprogress/next";

/**
 * Syncs a tab selection with the ?tab= URL query parameter.
 *
 * The active tab is CLIENT state — switching tabs updates the URL via
 * window.history.replaceState instead of router.replace, so it does NOT trigger
 * an RSC refetch. The tabbed pages (/tournaments/[id], /t/[token], /clubs/[id])
 * are force-dynamic and never read ?tab on the server, so a router.replace would
 * re-run EVERY page data fetch (3–5s per click) just to change a client-only
 * view. history.replaceState keeps the URL shareable/deep-linkable at zero
 * server cost, so tab switches are instant.
 *
 * - Initial tab is read from ?tab= (deep-link); falls back to defaultTab when the
 *   param is absent, unknown (allTabs), or not currently visible (validTabs).
 * - Lazy-mounts: tracks visited tabs so callers can defer rendering content.
 * - onChange writes ?tab=next (or strips it when next === defaultTab) so the
 *   canonical default URL stays clean.
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

  const pathname = usePathname();
  const searchParams = useSearchParams();

  const resolve = (raw: string | null): T =>
    raw && allTabs.includes(raw as T) && validTabs.includes(raw as T)
      ? (raw as T)
      : defaultTab;

  // Active tab is client state, seeded once from the URL for deep-link support.
  // (Reading searchParams in the initializer is SSR-safe: force-dynamic pages
  // have the query available during server render, so hydration matches.)
  const [active, setActive] = useState<T>(() => resolve(searchParams.get("tab")));

  // Lazy-mount tracking: seed with active AND defaultTab so neither is ever null
  // on first render even when ?tab= points elsewhere.
  const [mounted, setMounted] = useState<Set<T>>(
    () => new Set<T>([active, defaultTab])
  );

  // If the visible-tab set shrinks and the active tab is no longer valid
  // (a conditional tab disappeared), fall back to the default.
  useEffect(() => {
    if (!validTabs.includes(active)) setActive(defaultTab);
  }, [validTabs, active, defaultTab]);

  // On mount, reconcile the URL with the rendered tab (strip an absent/invalid/
  // default ?tab=, or restore the canonical one) — via replaceState, no refetch.
  const cleanedRef = useRef(false);
  useEffect(() => {
    if (cleanedRef.current) return;
    cleanedRef.current = true;
    const raw = searchParams.get("tab");
    const wantParam = active !== defaultTab;
    if (wantParam ? raw !== active : raw !== null) {
      const params = new URLSearchParams(window.location.search);
      if (wantParam) params.set("tab", String(active));
      else params.delete("tab");
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    }
  }, [active, defaultTab, pathname, searchParams]);

  // Drive the top @bprogress bar while a heavy tab's client render commits.
  // startedRef ensures exactly one stop() per start().
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
    const t = next as T;
    // No-op on the already-active tab: without this, startTransition fires with no
    // work to commit, isPending never toggles, and the progress bar hangs.
    if (t === active) return;

    // Update the URL bar WITHOUT router.replace → no RSC refetch on these
    // force-dynamic pages (every page DB fetch would otherwise re-run per click).
    const params = new URLSearchParams(window.location.search);
    if (t === defaultTab) params.delete("tab");
    else params.set("tab", String(t));
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);

    setMounted((prev) => (prev.has(t) ? prev : new Set([...prev, t])));
    progress.start();
    startedRef.current = true;
    startTransition(() => setActive(t));
  };

  return { active, mounted, onChange };
}
