import { DIVISION_COLORS } from "./divisions";

export type ClassTone = (typeof DIVISION_COLORS)[number];

/** Returns a tone from the division palette, cycling every 8 classes. */
export function classTone(index: number): ClassTone {
  return DIVISION_COLORS[index % DIVISION_COLORS.length];
}

export const NEUTRAL_TONE: ClassTone = {
  border: "border-border",
  bg: "bg-muted",
  text: "text-muted-foreground",
};

/**
 * Given the position-ordered classes array and a classId, returns the tone for
 * that class. Falls back to a neutral tone when classId is null or not found.
 */
export function classToneById(
  classes: { id: string }[],
  classId: string | null | undefined,
): ClassTone {
  if (!classId) return NEUTRAL_TONE;
  const index = classes.findIndex((c) => c.id === classId);
  if (index === -1) return NEUTRAL_TONE;
  return classTone(index);
}
