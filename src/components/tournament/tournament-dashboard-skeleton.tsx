// Dashboard skeleton — used as both the route-level fallback shape AND the
// Suspense / next-dynamic fallback while the recharts bundle loads on the
// client. Server component, pure Tailwind.
import { Skeleton } from "@/components/ui/skeleton";

export function TournamentDashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* 4 summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>

      {/* 2 top-performer cards */}
      <div className="grid sm:grid-cols-2 gap-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>

      {/* 2 chart cards */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>

      {/* Court usage chart */}
      <Skeleton className="h-56" />
    </div>
  );
}
