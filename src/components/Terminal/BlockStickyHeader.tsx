/**
 * BlockStickyHeader.tsx — pins the command of the block currently occupying
 * the top of the viewport (VS Code "sticky scroll"). Click = focus that block.
 * Hidden during alt-buffer and when the top row isn't inside a block region.
 */
import React, { useEffect, useReducer } from 'react';
import type { TabInfo } from '../../types';
import { terminalInstances } from './terminalRegistry';
import { blocksFor, frameRange, type CommandBlock } from './blocks';
import { blockFocus, blockStatusClass, blockBadgeText, type BlockCtx } from './blockActions';

export const BlockStickyHeader: React.FC<{ tab: TabInfo }> = ({ tab }) => {
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const inst = terminalInstances.get(tab.id);
    if (!inst) return;
    const d1 = inst.terminal.onRender(() => bump());
    const d2 = inst.terminal.onScroll(() => bump());
    return () => { try { d1.dispose(); } catch {} try { d2.dispose(); } catch {} };
  }, [tab.id]);

  const inst = terminalInstances.get(tab.id);
  if (!inst) return null;
  const term = inst.terminal;
  if (term.buffer.active.type === 'alternate') return null;

  const top = term.buffer.active.viewportY;
  const blocks = blocksFor(tab.id);
  // The block whose region contains the top viewport row.
  let current: CommandBlock | null = null;
  for (const b of blocks) {
    const { start, end } = frameRange(tab.id, term, b);
    if (start >= 0 && start <= top && top < end) { current = b; }
  }
  // Don't shadow the real prompt row (the command is already visible there).
  if (!current || current.promptMarker?.line === top) return null;

  const ctx: BlockCtx = { tabId: tab.id, tabType: tab.type, sessionId: tab.sessionId };
  const block = current;
  const cls = blockStatusClass(block);
  const badge = blockBadgeText(block, '…');

  return (
    <div className="gw-sticky" onMouseDown={() => blockFocus(ctx, block)}>
      <span className={`gw-card-badge ${cls}`}>{badge}</span>
      <span className="gw-sticky-cmd">{block.command || '—'}</span>
    </div>
  );
};
