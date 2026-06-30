import Image from "next/image";

/**
 * Kuanbad brand logo (navy + orange mark and wordmark). Decorative by default
 * (`alt=""`) — callers render the brand name as adjacent visible text, so the
 * logo must not be re-announced by screen readers. Intrinsic 1926×2048; size it
 * with a height utility + `w-auto` (e.g. `h-7 w-auto`).
 */
export function BrandLogo({
  className,
  priority,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/logo/kuanbad-brand.png"
      alt=""
      width={1926}
      height={2048}
      className={className}
      priority={priority}
    />
  );
}
