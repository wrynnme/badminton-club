// Route-level loading UI for /clubs/[id] (series home — see `series-home.tsx`).
// Shape mirrors the default "overview" tab: header, tab strip, active-session
// card, then a short session-history list.
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header: series name */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-[220px]" />
      </div>

      {/* Tab strip (ภาพรวม · สมาชิก · ตั้งค่า) */}
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>

      {/* Action row (จัดก๊วน button + badges) */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>

      {/* Active session card */}
      <SkeletonCard h={140} />

      {/* Session history list */}
      <div className="space-y-2">
        <Skeleton className="h-5 w-28" />
        <SkeletonCard h={64} />
        <SkeletonCard h={64} />
        <SkeletonCard h={64} />
      </div>
    </div>
  );
}
