// Route-level loading UI for /clubs/[id]/s/[sid] (session detail).
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-6 w-6 rounded-full" />
        <Skeleton className="h-8 w-[200px]" />
      </div>
      {/* Info card */}
      <SkeletonCard h={120} />
      {/* Stat row */}
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-6" />
        <Skeleton className="h-6" />
        <Skeleton className="h-6" />
      </div>
      {/* Main content grid */}
      <div className="grid sm:grid-cols-2 gap-3">
        <SkeletonCard h={80} />
        <SkeletonCard h={80} />
        <SkeletonCard h={80} />
        <SkeletonCard h={80} />
        <SkeletonCard h={80} />
        <SkeletonCard h={80} />
      </div>
    </div>
  );
}
