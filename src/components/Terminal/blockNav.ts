/**
 * blockNav.ts — keyboard navigation between command blocks.
 *
 * Imported by actions.ts so that block.prev / block.next / block.focus key
 * actions can scroll the active terminal to the nearest previous / next
 * command prompt, or open the focus panel for the current block.
 *
 * We import terminalInstances from the shared registry (terminalRegistry.ts)
 * rather than from TerminalView.tsx to avoid a circular dependency.
 */

import { terminalInstances } from './terminalRegistry';
import { blocksFor, type CommandBlock } from './blocks';
import { blockFocus } from './blockActions';
import { useAppStore } from '../../stores/appStore';

/** Briefly highlight a block's card decoration element, if present. */
export function flashBlock(block: CommandBlock): void {
  const el = block.deco?.element;
  if (!el) return;
  el.classList.add('gw-card-flash');
  setTimeout(() => { try { el.classList.remove('gw-card-flash'); } catch {} }, 700);
}

/**
 * Scroll the active terminal to the adjacent command block.
 *
 * @param dir  1 = next block (down), -1 = previous block (up)
 */
export function scrollToAdjacentBlock(dir: 1 | -1): void {
  const { activeTabId } = useAppStore.getState();
  if (!activeTabId) return;

  const inst = terminalInstances.get(activeTabId);
  if (!inst) return;

  const term = inst.terminal;
  const blocks = blocksFor(activeTabId).filter(
    (b) => b.promptMarker && b.promptMarker.line >= 0,
  );
  if (blocks.length === 0) return;

  // Current viewport top line in the full scrollback buffer.
  const viewportY = term.buffer.active.viewportY;

  if (dir === -1) {
    // Previous block: last block whose prompt line is strictly above viewport top.
    let target: CommandBlock | null = null;
    for (const b of blocks) {
      if (b.promptMarker!.line < viewportY) target = b;
    }
    if (target) { term.scrollToLine(target.promptMarker!.line); flashBlock(target); }
  } else {
    // Next block: first block whose prompt line is strictly below viewport top.
    for (const b of blocks) {
      if (b.promptMarker!.line > viewportY) {
        term.scrollToLine(b.promptMarker!.line);
        flashBlock(b);
        return;
      }
    }
  }
}

/** Focus (open the panel for) the block whose prompt is at/above viewport top. */
export function focusViewportBlock(): void {
  const { activeTabId, tabs } = useAppStore.getState();
  if (!activeTabId) return;
  const inst = terminalInstances.get(activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!inst || !tab) return;
  const term = inst.terminal;
  const viewportY = term.buffer.active.viewportY;
  const blocks = blocksFor(activeTabId).filter((b) => b.promptMarker && b.promptMarker.line >= 0);
  if (blocks.length === 0) return;
  let target = blocks[0];
  for (const b of blocks) { if (b.promptMarker!.line <= viewportY) target = b; }
  blockFocus({ tabId: tab.id, tabType: tab.type, sessionId: tab.sessionId }, target);
}
