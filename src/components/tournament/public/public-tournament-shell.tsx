"use client";

import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabId = "dashboard" | "overview" | "groups" | "pairs" | "knockout" | "queue";

export function PublicTournamentShell({
  dashboard,
  overview,
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
  overview: ReactNode;
  groups?: ReactNode;
  pairs?: ReactNode;
  knockout?: ReactNode;
  queue?: ReactNode;
  showGroups: boolean;
  showPairs: boolean;
  showKnockout: boolean;
  showQueue: boolean;
}) {
  const [active, setActive] = useState<TabId>("dashboard");
  const [mounted, setMounted] = useState<Set<TabId>>(() => new Set<TabId>(["dashboard"]));

  const onChange = (v: string) => {
    const next = v as TabId;
    setActive(next);
    setMounted((prev) => (prev.has(next) ? prev : new Set([...prev, next])));
  };

  return (
    <Tabs value={active} onValueChange={onChange} className="w-full">
      <TabsList
        variant="line"
        className="w-full justify-start gap-0 rounded-none border-b bg-transparent pb-0 h-auto flex-wrap"
      >
        <TabsTrigger value="dashboard" className="px-4 pb-3 pt-1 rounded-none text-sm sm:text-base">
          แดชบอร์ด
        </TabsTrigger>
        <TabsTrigger value="overview" className="px-4 pb-3 pt-1 rounded-none text-sm sm:text-base">
          ภาพรวม
        </TabsTrigger>
        {showGroups && (
          <TabsTrigger value="groups" className="px-4 pb-3 pt-1 rounded-none text-sm sm:text-base">
            กลุ่ม
          </TabsTrigger>
        )}
        {showPairs && (
          <TabsTrigger value="pairs" className="px-4 pb-3 pt-1 rounded-none text-sm sm:text-base">
            คู่
          </TabsTrigger>
        )}
        {showKnockout && (
          <TabsTrigger value="knockout" className="px-4 pb-3 pt-1 rounded-none text-sm sm:text-base">
            สาย
          </TabsTrigger>
        )}
        {showQueue && (
          <TabsTrigger value="queue" className="px-4 pb-3 pt-1 rounded-none text-sm sm:text-base">
            ตารางคิว
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="dashboard" className="mt-6">
        {mounted.has("dashboard") ? dashboard : null}
      </TabsContent>
      <TabsContent value="overview" className="mt-6">
        {mounted.has("overview") ? overview : null}
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
