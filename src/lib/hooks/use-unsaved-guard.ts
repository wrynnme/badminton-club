/**
 * Module-level "is anything dirty right now" registry, shared across every
 * component on the page that has switched from auto-save to an explicit
 * Save/Discard flow. Each such component registers a stable string key and
 * flips it dirty/clean as its own draft changes — callers that only need a
 * yes/no answer (e.g. a tab-switch guard) call `hasUnsavedChanges()` without
 * needing to know which key(s) are dirty.
 *
 * Deliberately NOT React state: this needs to be read from plain event
 * handlers (tab onValueChange, beforeunload) that live outside any single
 * component's render tree, so a module-level Set is simpler than threading
 * context through the tab shell. No consumer currently re-renders off this
 * value, so there is no subscribe/emit layer — add one only when a component
 * genuinely needs to render off the dirty flag.
 */
const dirtyKeys = new Set<string>();

/** Mark `key` dirty or clean. Call with `false` on unmount to avoid leaking a stale key. */
export function setUnsavedGuard(key: string, isDirty: boolean): void {
  if (isDirty) dirtyKeys.add(key);
  else dirtyKeys.delete(key);
}

/** True if any registered key currently has unsaved changes. */
export function hasUnsavedChanges(): boolean {
  return dirtyKeys.size > 0;
}
