"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabId = "dashboard" | "teams" | "groups" | "pairs" | "knockout" | "queue" | "settings";

export function TournamentTabs({
  dashboardTab,
  teamsTab,
  groupsTab,
  pairsTab,
  knockoutTab,
  queueTab,
  settingsTab,
  showGroups,
  showPairs,
  showKnockout,
  showQueue,
  showSettings,
}: {
  dashboardTab: ReactNode;
  teamsTab: ReactNode;
  groupsTab?: ReactNode;
  pairsTab?: ReactNode;
  knockoutTab?: ReactNode;
  queueTab?: ReactNode;
  settingsTab?: ReactNode;
  showGroups: boolean;
  showPairs: boolean;
  showKnockout: boolean;
  showQueue: boolean;
  showSettings: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const validTabs = useMemo(() => {
    const list: TabId[] = ["dashboard", "teams"];
    if (showGroups) list.push("groups");
    if (showPairs) list.push("pairs");
    if (showKnockout) list.push("knockout");
    if (showQueue) list.push("queue");
    if (showSettings) list.push("settings");
    return list;
  }, [showGroups, showPairs, showKnockout, showQueue, showSettings]);

  const queryTab = searchParams.get("tab") as TabId | null;
  // Default landing tab is "teams" — keeps recharts out of the initial bundle
  // for typical viewers. Users opt into the dashboard by clicking the tab,
  // which lazy-mounts it.
  const activeTab: TabId =
    queryTab && validTabs.includes(queryTab) ? queryTab : "teams";

  // Lazy-mount: each tab content only renders after first visit. After mount,
  // it stays mounted so switching back is instant + preserves local state.
  const [mounted, setMounted] = useState<Set<TabId>>(() => new Set([activeTab]));
  useEffect(() => {
    setMounted((prev) => (prev.has(activeTab) ? prev : new Set([...prev, activeTab])));
  }, [activeTab]);

  // If URL points to a tab that doesn't exist for this viewer (e.g.
  // ?tab=settings as a non-admin), strip the param so the canonical URL
  // matches the actually-rendered tab.
  const searchString = searchParams.toString();
  useEffect(() => {
    if (queryTab && !validTabs.includes(queryTab)) {
      const params = new URLSearchParams(searchString);
      params.delete("tab");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [queryTab, validTabs, router, pathname, searchString]);

  const onValueChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    // "teams" is the canonical default — strip the ?tab= param for it so the
    // URL stays clean. All other tabs (including dashboard) get an explicit
    // ?tab=<id>.
    if (next === "teams") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <Tabs value={activeTab} onValueChange={onValueChange}>
      <TabsList className="w-full flex-wrap h-auto">
        <TabsTrigger value="dashboard">แดชบอร์ด</TabsTrigger>
        <TabsTrigger value="teams">ทีม</TabsTrigger>
        {showGroups && <TabsTrigger value="groups">กลุ่ม</TabsTrigger>}
        {showPairs && <TabsTrigger value="pairs">คู่</TabsTrigger>}
        {showKnockout && <TabsTrigger value="knockout">น็อคเอ้า</TabsTrigger>}
        {showQueue && <TabsTrigger value="queue">ตารางคิว</TabsTrigger>}
        {showSettings && <TabsTrigger value="settings">ตั้งค่า</TabsTrigger>}
      </TabsList>

      <TabsContent value="dashboard" className="mt-6">
        {mounted.has("dashboard") ? dashboardTab : null}
      </TabsContent>

      <TabsContent value="teams" className="mt-6">
        {mounted.has("teams") ? teamsTab : null}
      </TabsContent>

      {showGroups && (
        <TabsContent value="groups" className="mt-6">
          {mounted.has("groups") ? groupsTab : null}
        </TabsContent>
      )}

      {showPairs && (
        <TabsContent value="pairs" className="mt-6">
          {mounted.has("pairs") ? pairsTab : null}
        </TabsContent>
      )}

      {showKnockout && (
        <TabsContent value="knockout" className="mt-6">
          {mounted.has("knockout") ? knockoutTab : null}
        </TabsContent>
      )}

      {showQueue && (
        <TabsContent value="queue" className="mt-6">
          {mounted.has("queue") ? queueTab : null}
        </TabsContent>
      )}

      {showSettings && (
        <TabsContent value="settings" className="mt-6 space-y-6">
          {mounted.has("settings") ? settingsTab : null}
        </TabsContent>
      )}
    </Tabs>
  );
}
