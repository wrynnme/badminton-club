"use client";

import { useMemo, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTabSync } from "@/lib/hooks/use-tab-sync";

type TabId = "dashboard" | "teams" | "groups" | "pairs" | "knockout" | "queue" | "settings";

const ALL_TABS: readonly TabId[] = [
  "dashboard",
  "teams",
  "groups",
  "pairs",
  "knockout",
  "queue",
  "settings",
];

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
  const validTabs = useMemo<readonly TabId[]>(() => {
    const list: TabId[] = ["dashboard", "teams"];
    if (showGroups) list.push("groups");
    if (showPairs) list.push("pairs");
    if (showKnockout) list.push("knockout");
    if (showQueue) list.push("queue");
    if (showSettings) list.push("settings");
    return list;
  }, [showGroups, showPairs, showKnockout, showQueue, showSettings]);

  // Default landing tab is "teams" — keeps recharts out of the initial bundle
  // for typical viewers. Users opt into the dashboard by clicking the tab,
  // which lazy-mounts it.
  const { active, mounted, onChange } = useTabSync<TabId>({
    allTabs: ALL_TABS,
    validTabs,
    defaultTab: "teams",
  });

  return (
    <Tabs value={active} onValueChange={onChange}>
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
