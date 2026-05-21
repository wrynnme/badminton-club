"use client";

// Client-side lazy wrapper for <TournamentDashboard>. Splits the heavy
// recharts bundle out of the initial route chunk: the dashboard module is
// only fetched when this component actually renders (which itself is
// gated by tab lazy-mount in tournament-tabs.tsx / public-tournament-shell.tsx).
// While the chunk loads, <TournamentDashboardSkeleton> shows.

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { TournamentDashboardSkeleton } from "@/components/tournament/tournament-dashboard-skeleton";
import type { TournamentDashboard as TournamentDashboardType } from "@/components/tournament/tournament-dashboard";

const TournamentDashboard = dynamic(
  () =>
    import("@/components/tournament/tournament-dashboard").then(
      (m) => m.TournamentDashboard,
    ),
  {
    loading: () => <TournamentDashboardSkeleton />,
    ssr: false,
  },
);

type Props = ComponentProps<typeof TournamentDashboardType>;

export function TournamentDashboardLazy(props: Props) {
  return <TournamentDashboard {...props} />;
}
