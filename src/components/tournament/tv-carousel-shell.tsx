"use client";

import { useEffect, useState } from "react";

/**
 * Shared rotation state for TV carousels. Returns `safeActive` index (clamped
 * read-time so a shrinking `pageCount` never returns out-of-range) and a
 * stable `setActive` setter. Cycles every `intervalMs` when `pageCount > 1`
 * and pauses while the tab is hidden so background tabs don't burn timer ticks.
 *
 * The clamping-at-read-time pattern avoids the extra render that an
 * `if (active >= pageCount) setActive(0)` effect would cause when pages shrink.
 */
export function useCarousel(
  pageCount: number,
  intervalMs: number,
): { active: number; setActive: (n: number) => void } {
  const [active, setActive] = useState(0);
  const safeActive = Math.min(active, Math.max(0, pageCount - 1));

  useEffect(() => {
    if (pageCount <= 1) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!id) id = setInterval(() => setActive((i) => (i + 1) % pageCount), intervalMs);
    };
    const stop = () => {
      if (id) { clearInterval(id); id = null; }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [pageCount, intervalMs]);

  return { active: safeActive, setActive };
}

/**
 * Dot-navigation control shared by TV carousels. Renders one dot per page,
 * highlights the active dot, and dispatches `onSelect` on click. Renders
 * nothing when `count <= 1`.
 */
export function TvCarouselDots({
  count,
  active,
  onSelect,
  labels,
}: {
  count: number;
  active: number;
  onSelect: (n: number) => void;
  /** Optional per-dot accessibility label (defaults to "ไปหน้า {i+1}"). */
  labels?: (i: number) => string;
}) {
  if (count <= 1) return null;
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(i)}
          aria-label={labels ? labels(i) : `ไปหน้า ${i + 1}`}
          aria-current={i === active}
          className={`w-3 h-3 lg:w-3.5 lg:h-3.5 rounded-full transition-colors cursor-pointer hover:bg-foreground/70 ${
            i === active ? "bg-foreground" : "bg-muted"
          }`}
        />
      ))}
    </div>
  );
}
