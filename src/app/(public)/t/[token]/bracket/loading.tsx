// Route-level loading UI for /t/[token]/bracket.
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8">
      <div className="flex items-center gap-2">
        <Skeleton className="h-6 w-6 rounded-full" />
        <Skeleton className="h-8 w-[200px]" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-6" />
        <Skeleton className="h-6" />
        <Skeleton className="h-6" />
      </div>
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
