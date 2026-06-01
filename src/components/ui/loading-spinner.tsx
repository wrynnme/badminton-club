import { cn } from "@/lib/utils";

export function LoadingSpinner({
  className,
  fullscreen = false,
}: {
  className?: string;
  fullscreen?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center text-muted-foreground",
        fullscreen ? "min-h-screen" : "min-h-[60vh]",
        className,
      )}
    >
      <span className="loader" role="status" aria-label="กำลังโหลด" />
    </div>
  );
}
