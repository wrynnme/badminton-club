import Image from "next/image";

/**
 * Kuanbad brand logo — vector mark (blue + orange badminton figure, no
 * wordmark; callers render the brand name as adjacent visible text, so the
 * logo stays decorative with `alt=""` and is not re-announced by screen
 * readers). SVG source of truth: public/logo/kuanbad.svg (1.7 KB, crisp at
 * every DPR). Intrinsic viewBox 1031×1096; size with a height utility +
 * `w-auto` (e.g. `h-7 w-auto`).
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
      src="/logo/kuanbad.svg"
      alt=""
      width={1031}
      height={1096}
      className={className}
      priority={priority}
    />
  );
}
