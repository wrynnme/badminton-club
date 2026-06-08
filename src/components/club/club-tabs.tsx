"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTabSync } from "@/lib/hooks/use-tab-sync";

type ClubTabId = "dashboard" | "checkin" | "queue" | "cost" | "settings";
const ALL_TABS: readonly ClubTabId[] = ["dashboard", "checkin", "queue", "cost", "settings"];

/**
 * Client tab shell for the club detail page. Receives the server-rendered
 * sections as props and shows one at a time, syncing the active tab to ?tab=.
 * Dashboard is the default landing tab; settings is only present for managers
 * (owner / co-admin).
 */
export function ClubTabs({
  dashboard,
  checkin,
  queue,
  cost,
  settings,
  showSettings,
}: {
  dashboard: ReactNode;
  checkin: ReactNode;
  queue: ReactNode;
  cost: ReactNode;
  settings: ReactNode;
  showSettings: boolean;
}) {
  const validTabs: readonly ClubTabId[] = showSettings
    ? ALL_TABS
    : (["dashboard", "checkin", "queue", "cost"] as const);

  const { active, mounted, onChange } = useTabSync<ClubTabId>({
    allTabs: ALL_TABS,
    validTabs,
    defaultTab: "dashboard",
  });

  return (
    <Tabs value={active} onValueChange={(v) => onChange(String(v))} className="space-y-4">
      <TabsList className="w-full flex-wrap h-auto">
        <TabsTrigger value="dashboard">แดชบอร์ด</TabsTrigger>
        <TabsTrigger value="checkin">ลงชื่อ / เช็คอิน</TabsTrigger>
        <TabsTrigger value="queue">ล็อคคู่ + คิว</TabsTrigger>
        <TabsTrigger value="cost">ค่าใช้จ่าย</TabsTrigger>
        {showSettings && <TabsTrigger value="settings">ตั้งค่า</TabsTrigger>}
      </TabsList>

      <TabsContent value="dashboard">{mounted.has("dashboard") && dashboard}</TabsContent>
      <TabsContent value="checkin">{mounted.has("checkin") && checkin}</TabsContent>
      <TabsContent value="queue">{mounted.has("queue") && queue}</TabsContent>
      <TabsContent value="cost">{mounted.has("cost") && cost}</TabsContent>
      {showSettings && (
        <TabsContent value="settings">{mounted.has("settings") && settings}</TabsContent>
      )}
    </Tabs>
  );
}
