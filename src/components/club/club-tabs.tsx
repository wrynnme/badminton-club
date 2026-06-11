"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
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
  hideCost = false,
}: {
  dashboard: ReactNode;
  checkin: ReactNode;
  queue: ReactNode;
  cost: ReactNode;
  settings: ReactNode;
  showSettings: boolean;
  /** Public read-only view: drop the cost/money tab entirely. */
  hideCost?: boolean;
}) {
  // Single source of which tabs exist for this view; the TabsTrigger/TabsContent
  // below gate off membership here (not off hideCost/showSettings directly) so the
  // tab set can't drift. Memoized so useTabSync's deps stay reference-stable across
  // the page's realtime/30s auto-refresh re-renders.
  const t = useTranslations("club.tabs");

  const validTabs = useMemo<readonly ClubTabId[]>(
    () => ALL_TABS.filter((tabId) => (tabId !== "cost" || !hideCost) && (tabId !== "settings" || showSettings)),
    [hideCost, showSettings],
  );

  const { active, mounted, onChange } = useTabSync<ClubTabId>({
    allTabs: ALL_TABS,
    validTabs,
    defaultTab: "dashboard",
  });

  return (
    <Tabs value={active} onValueChange={(v) => onChange(String(v))} className="space-y-4">
      <TabsList className="w-full flex-wrap h-auto">
        <TabsTrigger value="dashboard">{t("dashboard")}</TabsTrigger>
        <TabsTrigger value="checkin">{t("checkin")}</TabsTrigger>
        <TabsTrigger value="queue">{t("queue")}</TabsTrigger>
        {validTabs.includes("cost") && <TabsTrigger value="cost">{t("cost")}</TabsTrigger>}
        {validTabs.includes("settings") && <TabsTrigger value="settings">{t("settings")}</TabsTrigger>}
      </TabsList>

      <TabsContent value="dashboard">{mounted.has("dashboard") && dashboard}</TabsContent>
      <TabsContent value="checkin">{mounted.has("checkin") && checkin}</TabsContent>
      <TabsContent value="queue">{mounted.has("queue") && queue}</TabsContent>
      {validTabs.includes("cost") && (
        <TabsContent value="cost">{mounted.has("cost") && cost}</TabsContent>
      )}
      {validTabs.includes("settings") && (
        <TabsContent value="settings">{mounted.has("settings") && settings}</TabsContent>
      )}
    </Tabs>
  );
}
