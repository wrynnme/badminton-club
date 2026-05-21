// Route-level loading UI for /tournaments (list).
import { SkeletonCard } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <SkeletonCard h={100} />
      <SkeletonCard h={100} />
      <SkeletonCard h={100} />
      <SkeletonCard h={100} />
    </div>
  );
}
