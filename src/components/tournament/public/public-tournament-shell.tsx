"use client";

import { useMemo, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTabSync } from "@/lib/hooks/use-tab-sync";

type TabId = "dashboard" | "groups" | "pairs" | "knockout" | "queue";

const ALL_TABS: readonly TabId[] = ["dashboard", "groups", "pairs", "knockout", "queue"];

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
  const validTabs = useMemo<readonly TabId[]>(() => {
    const list: TabId[] = ["dashboard"];
    if (showGroups) list.push("groups");
    if (showPairs) list.push("pairs");
    if (showKnockout) list.push("knockout");
    if (showQueue) list.push("queue");
    return list;
  }, [showGroups, showPairs, showKnockout, showQueue]);

  const { active, mounted, onChange } = useTabSync<TabId>({
    allTabs: ALL_TABS,
    validTabs,
    defaultTab: "dashboard",
  });

  return (
    <Tabs value={active} onValueChange={onChange} className="w-full">
      <TabsList
        variant="line"
        className="w-full justify-start gap-0 rounded-none border-b bg-transparent pb-0 h-auto flex-wrap"
      >
        <TabsTrigger value="dashboard" className="min-h-11 px-2 sm:px-4 pb-3 pt-1 rounded-none text-xs sm:text-sm">
          แดชบอร์ด
        </TabsTrigger>
        {showGroups && (
          <TabsTrigger value="groups" className="min-h-11 px-2 sm:px-4 pb-3 pt-1 rounded-none text-xs sm:text-sm">
            กลุ่ม
          </TabsTrigger>
        )}
        {showPairs && (
          <TabsTrigger value="pairs" className="min-h-11 px-2 sm:px-4 pb-3 pt-1 rounded-none text-xs sm:text-sm">
            คู่
          </TabsTrigger>
        )}
        {showKnockout && (
          <TabsTrigger value="knockout" className="min-h-11 px-2 sm:px-4 pb-3 pt-1 rounded-none text-xs sm:text-sm">
            สาย
          </TabsTrigger>
        )}
        {showQueue && (
          <TabsTrigger value="queue" className="min-h-11 px-2 sm:px-4 pb-3 pt-1 rounded-none text-xs sm:text-sm">
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
