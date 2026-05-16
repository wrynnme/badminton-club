"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabId = "teams" | "groups" | "pairs" | "knockout" | "queue" | "settings";

export function TournamentTabs({
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
    const list: TabId[] = ["teams"];
    if (showGroups) list.push("groups");
    if (showPairs) list.push("pairs");
    if (showKnockout) list.push("knockout");
    if (showQueue) list.push("queue");
    if (showSettings) list.push("settings");
    return list;
  }, [showGroups, showPairs, showKnockout, showQueue, showSettings]);

  const queryTab = searchParams.get("tab") as TabId | null;
  const activeTab: TabId =
    queryTab && validTabs.includes(queryTab) ? queryTab : "teams";

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
    if (next === "teams") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <Tabs value={activeTab} onValueChange={onValueChange}>
      <TabsList className="w-full flex-wrap h-auto">
        <TabsTrigger value="teams">ทีม</TabsTrigger>
        {showGroups && <TabsTrigger value="groups">กลุ่ม</TabsTrigger>}
        {showPairs && <TabsTrigger value="pairs">คู่</TabsTrigger>}
        {showKnockout && <TabsTrigger value="knockout">Knockout</TabsTrigger>}
        {showQueue && <TabsTrigger value="queue">ตารางคิว</TabsTrigger>}
        {showSettings && <TabsTrigger value="settings">ตั้งค่า</TabsTrigger>}
      </TabsList>

      <TabsContent value="teams" className="mt-6">
        {teamsTab}
      </TabsContent>

      {showGroups && (
        <TabsContent value="groups" className="mt-6">
          {groupsTab}
        </TabsContent>
      )}

      {showPairs && (
        <TabsContent value="pairs" className="mt-6">
          {pairsTab}
        </TabsContent>
      )}

      {showKnockout && (
        <TabsContent value="knockout" className="mt-6">
          {knockoutTab}
        </TabsContent>
      )}

      {showQueue && (
        <TabsContent value="queue" className="mt-6">
          {queueTab}
        </TabsContent>
      )}

      {showSettings && (
        <TabsContent value="settings" className="mt-6 space-y-6">
          {settingsTab}
        </TabsContent>
      )}
    </Tabs>
  );
}
