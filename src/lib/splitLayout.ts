/** Pure helpers for the multi-pane split slot array. A "pane slot" holds a tab
 *  id or null (empty). Slot count equals the split count (2/4/6/8). */

/** Build the slot array of length `n` from the current terminal tab ids:
 *  the active tab leads (so it is always visible), then the rest in order,
 *  truncated to `n` and padded with null. */
export function buildSplitPanes(
  tabIds: string[],
  activeId: string | null,
  n: number,
): (string | null)[] {
  const ordered =
    activeId && tabIds.includes(activeId)
      ? [activeId, ...tabIds.filter((id) => id !== activeId)]
      : [...tabIds];
  const panes: (string | null)[] = ordered.slice(0, n);
  while (panes.length < n) panes.push(null);
  return panes;
}

/** Null out any slot holding `tabId` (used when a tab closes). */
export function clearSlot(panes: (string | null)[], tabId: string): (string | null)[] {
  return panes.map((p) => (p === tabId ? null : p));
}

/** Put `tabId` into the first empty slot, unless it is already present or there
 *  is no empty slot. Used when a new terminal tab opens during a split. */
export function fillFirstEmpty(panes: (string | null)[], tabId: string): (string | null)[] {
  if (panes.includes(tabId)) return panes;
  const i = panes.indexOf(null);
  if (i === -1) return panes;
  const next = [...panes];
  next[i] = tabId;
  return next;
}
