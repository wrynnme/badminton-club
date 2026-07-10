"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Multi-select state for ONE list section (e.g. the queue's pending or completed
 * block). Owns the select-mode toggle + the selected-id set, prunes ids that
 * leave the list on every change, and — crucially — auto-exits select mode once
 * the list is empty. Without that exit, bulk-clearing/deleting a whole section
 * unmounts its toggle while `selectMode` silently stays true, so the section
 * reappears already in select mode on the next batch the user never enabled.
 *
 * `ids` is the CURRENT set of selectable row ids in the section. The effect keys
 * on a joined signature so a caller that rebuilds the array every render (a plain
 * `.filter().map()`) does not churn the effect.
 */
export function useRowSelection(ids: string[]) {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const idKey = ids.join(",");

  useEffect(() => {
    const live = new Set(ids);
    setSelectedIds((prev) => {
      const pruned = new Set([...prev].filter((id) => live.has(id)));
      return pruned.size === prev.size ? prev : pruned;
    });
    if (ids.length === 0) setSelectMode(false);
    // ids is captured via idKey (content signature); re-run only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  const toggleMode = useCallback(() => {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
  const partialSelected = selectedIds.size > 0 && !allSelected;

  const selectAll = useCallback(() => {
    setSelectedIds((prev) => (prev.size === ids.length ? new Set() : new Set(ids)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  return {
    selectMode,
    toggleMode,
    selectedIds,
    toggleSelect,
    clear,
    allSelected,
    partialSelected,
    selectAll,
  };
}
