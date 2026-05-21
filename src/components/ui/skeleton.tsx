// Minimal Tailwind-only skeleton primitives used by loading.tsx route files.
// Server component — pure HTML, zero JS runtime. Shadcn doesn't ship a
// Skeleton component in this project, so we keep one tiny helper here that
// every loading.tsx imports.

type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className = "" }: SkeletonProps) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

// A simple card-shaped block. Useful for list rows and feature cards.
export function SkeletonCard({ h = 80, className = "" }: { h?: number; className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg border bg-card ${className}`}
      style={{ height: h }}
    />
  );
}
