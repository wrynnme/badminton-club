import { Loader2 } from "lucide-react";
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
        "flex items-center justify-center",
        fullscreen ? "min-h-screen" : "min-h-[60vh]",
        className,
      )}
    >
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
