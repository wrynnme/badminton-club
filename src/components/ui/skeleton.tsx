import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

function SkeletonCard({
  h = 80,
  className,
  ...props
}: React.ComponentProps<"div"> & { h?: number }) {
  return (
    <div
      data-slot="skeleton-card"
      className={cn("animate-pulse rounded-lg border bg-card", className)}
      style={{ height: h, ...props.style }}
      {...props}
    />
  )
}

export { Skeleton, SkeletonCard }
