/**
 * blockNav.ts — keyboard navigation between command blocks.
 *
 * Imported by actions.ts so that block.prev / block.next key actions can
 * scroll the active terminal to the nearest previous / next command prompt.
 *
 * We import terminalInstances from the shared registry (terminalRegistry.ts)
 * rather than from TerminalView.tsx to avoid a circular dependency.
 */

import { terminalInstances } from './terminalRegistry';
import { blocksFor } from './blocks';
import { useAppStore } from '../../stores/appStore';

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
    let target: number | null = null;
    for (const b of blocks) {
      const line = b.promptMarker!.line;
      if (line < viewportY) target = line;
    }
    if (target !== null) term.scrollToLine(target);
  } else {
    // Next block: first block whose prompt line is strictly below viewport top.
    for (const b of blocks) {
      const line = b.promptMarker!.line;
      if (line > viewportY) {
        term.scrollToLine(line);
        return;
      }
    }
  }
}
