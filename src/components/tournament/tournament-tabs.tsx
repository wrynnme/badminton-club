"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function TournamentTabs({
  teamsTab,
  groupsTab,
  pairsTab,
  knockoutTab,
  settingsTab,
  showGroups,
  showPairs,
  showKnockout,
}: {
  teamsTab: ReactNode;
  groupsTab?: ReactNode;
  pairsTab?: ReactNode;
  knockoutTab?: ReactNode;
  settingsTab: ReactNode;
  showGroups: boolean;
  showPairs: boolean;
  showKnockout: boolean;
}) {
  return (
    <Tabs defaultValue="teams">
      <TabsList className="w-full flex-wrap h-auto">
        <TabsTrigger value="teams">ทีม</TabsTrigger>
        {showGroups && <TabsTrigger value="groups">กลุ่ม</TabsTrigger>}
        {showPairs && <TabsTrigger value="pairs">คู่</TabsTrigger>}
        {showKnockout && <TabsTrigger value="knockout">Knockout</TabsTrigger>}
        <TabsTrigger value="settings">ตั้งค่า</TabsTrigger>
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

      <TabsContent value="settings" className="mt-6 space-y-6">
        {settingsTab}
      </TabsContent>
    </Tabs>
  );
}
