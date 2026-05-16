"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function PublicTournamentShell({
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
  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList
        variant="line"
        className="w-full justify-start gap-0 rounded-none border-b bg-transparent pb-0 h-auto overflow-x-auto"
      >
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

      <TabsContent value="overview" className="mt-6">
        {overview}
      </TabsContent>
      {showGroups && (
        <TabsContent value="groups" className="mt-6">
          {groups}
        </TabsContent>
      )}
      {showPairs && (
        <TabsContent value="pairs" className="mt-6">
          {pairs}
        </TabsContent>
      )}
      {showKnockout && (
        <TabsContent value="knockout" className="mt-6">
          {knockout}
        </TabsContent>
      )}
      {showQueue && (
        <TabsContent value="queue" className="mt-6">
          {queue}
        </TabsContent>
      )}
    </Tabs>
  );
}
