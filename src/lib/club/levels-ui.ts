import type { Level } from "@/lib/types";

/**
 * levels-ui.ts — tiny shared helpers for level `<Select>` UIs on the club side
 * (pure level-resolution logic lives in `src/lib/club/levels.ts`).
 */

/** Radix/Base UI Select can't hold an empty-string value — sentinel for "no level". */
export const NONE_SENTINEL = "__none__";

/** Trigger label for a level Select: the level's label, or `noneLabel` when unset/unknown. */
export function levelTriggerLabel(levels: Level[], id: string | null, noneLabel: string): string {
  if (!id) return noneLabel;
  return levels.find((l) => l.id === id)?.label ?? noneLabel;
}
