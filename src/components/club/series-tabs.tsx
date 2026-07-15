"use client";

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTabSync } from "@/lib/hooks/use-tab-sync";

type SeriesTabId = "overview" | "members" | "stats" | "settings";
const ALL_TABS: readonly SeriesTabId[] = ["overview", "members", "stats", "settings"];

/**
 * Client tab shell for the series home page (ADR 0002 P2-C1, "stats" tab added
 * P4). Mirrors `ClubTabs` (`src/components/club/club-tabs.tsx`): receives
 * server-rendered sections as props, shows one at a time, syncs the active tab
 * to `?tab=`. Overview is the default landing tab. All four tabs are
 * unconditional — `SeriesHome` redirects non-managers before this ever renders.
 */
export function SeriesTabs({
  overview,
  members,
  stats,
  settings,
}: {
  overview: ReactNode;
  members: ReactNode;
  stats: ReactNode;
  settings: ReactNode;
}) {
  const t = useTranslations("club.seriesTabs");

  const { active, mounted, onChange } = useTabSync<SeriesTabId>({
    allTabs: ALL_TABS,
    validTabs: ALL_TABS,
    defaultTab: "overview",
  });

  return (
    <Tabs value={active} onValueChange={(v) => onChange(String(v))} className="space-y-4">
      <TabsList className="w-full flex-wrap h-auto">
        <TabsTrigger value="overview">{t("overview")}</TabsTrigger>
        <TabsTrigger value="members">{t("members")}</TabsTrigger>
        <TabsTrigger value="stats">{t("stats")}</TabsTrigger>
        <TabsTrigger value="settings">{t("settings")}</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">{mounted.has("overview") && overview}</TabsContent>
      <TabsContent value="members">{mounted.has("members") && members}</TabsContent>
      <TabsContent value="stats">{mounted.has("stats") && stats}</TabsContent>
      <TabsContent value="settings">{mounted.has("settings") && settings}</TabsContent>
    </Tabs>
  );
}
