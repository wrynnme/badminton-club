"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabId = "dashboard" | "groups" | "pairs" | "knockout" | "queue";

const ALL_TABS: TabId[] = ["dashboard", "groups", "pairs", "knockout", "queue"];

export function PublicTournamentShell({
  dashboard,
  groups,
  pairs,
  knockout,
  queue,
  showGroups,
  showPairs,
  showKnockout,
  showQueue,
}: {
  dashboard: ReactNode;
  groups?: ReactNode;
  pairs?: ReactNode;
  knockout?: ReactNode;
  queue?: ReactNode;
  showGroups: boolean;
  showPairs: boolean;
  showKnockout: boolean;
  showQueue: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const validTabs = useMemo<TabId[]>(() => {
    const list: TabId[] = ["dashboard"];
    if (showGroups) list.push("groups");
    if (showPairs) list.push("pairs");
    if (showKnockout) list.push("knockout");
    if (showQueue) list.push("queue");
    return list;
  }, [showGroups, showPairs, showKnockout, showQueue]);

  const queryTab = searchParams.get("tab") as TabId | null;
  const active: TabId =
    queryTab && ALL_TABS.includes(queryTab) && validTabs.includes(queryTab)
      ? queryTab
      : "dashboard";

  // Lazy-mount: each tab content only renders after first visit. After mount,
  // it stays mounted so switching back is instant + preserves local state.
  const [mounted, setMounted] = useState<Set<TabId>>(() => new Set<TabId>([active]));
  useEffect(() => {
    setMounted((prev) => (prev.has(active) ? prev : new Set([...prev, active])));
  }, [active]);

  // If URL points to a tab that is not valid for this viewer (e.g. a tab that
  // is conditionally hidden), strip the param so the canonical URL matches the
  // actually-rendered tab.
  const searchString = searchParams.toString();
  useEffect(() => {
    if (queryTab && !validTabs.includes(queryTab)) {
      const params = new URLSearchParams(searchString);
      params.delete("tab");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [queryTab, validTabs, router, pathname, searchString]);

  const onChange = (v: string) => {
    const next = v as TabId;
    const params = new URLSearchParams(searchParams.toString());
    // "dashboard" is the canonical default — strip ?tab= for it so the URL
    // stays clean. All other tabs get an explicit ?tab=<id>.
    if (next === "dashboard") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <Tabs value={active} onValueChange={onChange} className="w-full">
      <TabsList
        variant="line"
        className="w-full justify-start gap-0 rounded-none border-b bg-transparent pb-0 h-auto flex-wrap"
      >
        <TabsTrigger value="dashboard" className="px-2 sm:px-4 pb-3 pt-1 rounded-none text-xs sm:text-sm">
          แดชบอร์ด
        </TabsTrigger>
        {showGroups && (
          <TabsTrigger value="groups" className="px-2 sm:px-4 pb-3 pt-1 rounded-none text-xs sm:text-sm">
            กลุ่ม
          </TabsTrigger>
        )}
        {showPairs && (
          <TabsTrigger value="pairs" className="px-2 sm:px-4 pb-3 pt-1 rounded-none text-xs sm:text-sm">
            คู่
          </TabsTrigger>
        )}
        {showKnockout && (
          <TabsTrigger value="knockout" className="px-2 sm:px-4 pb-3 pt-1 rounded-none text-xs sm:text-sm">
            สาย
          </TabsTrigger>
        )}
        {showQueue && (
          <TabsTrigger value="queue" className="px-2 sm:px-4 pb-3 pt-1 rounded-none text-xs sm:text-sm">
            ตารางคิว
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="dashboard" className="mt-6">
        {mounted.has("dashboard") ? dashboard : null}
      </TabsContent>
      {showGroups && (
        <TabsContent value="groups" className="mt-6">
          {mounted.has("groups") ? groups : null}
        </TabsContent>
      )}
      {showPairs && (
        <TabsContent value="pairs" className="mt-6">
          {mounted.has("pairs") ? pairs : null}
        </TabsContent>
      )}
      {showKnockout && (
        <TabsContent value="knockout" className="mt-6">
          {mounted.has("knockout") ? knockout : null}
        </TabsContent>
      )}
      {showQueue && (
        <TabsContent value="queue" className="mt-6">
          {mounted.has("queue") ? queue : null}
        </TabsContent>
      )}
    </Tabs>
  );
}
