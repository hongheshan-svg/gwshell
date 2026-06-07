/**
 * BlockOverviewRuler.tsx — right-edge minimap: one colored tick per block,
 * positioned by promptMarker.line / total buffer length. Click = scroll there.
 * Custom (not xterm overviewRulerOptions) so clicks can jump to the block.
 */
import React, { useEffect, useReducer } from 'react';
import type { TabInfo } from '../../types';
import { terminalInstances } from './terminalRegistry';
import { blocksFor } from './blocks';
import { blockStatusClass } from './blockActions';
import { flashBlock } from './blockNav';

export const BlockOverviewRuler: React.FC<{ tab: TabInfo }> = ({ tab }) => {
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const inst = terminalInstances.get(tab.id);
    if (!inst) return;
    const d1 = inst.terminal.onRender(() => bump());
    const d2 = inst.terminal.onScroll(() => bump());
    const d3 = inst.terminal.onLineFeed(() => bump());
    return () => { try { d1.dispose(); } catch {} try { d2.dispose(); } catch {} try { d3.dispose(); } catch {} };
  }, [tab.id]);

  const inst = terminalInstances.get(tab.id);
  if (!inst) return null;
  const term = inst.terminal;
  if (term.buffer.active.type === 'alternate') return null;

  const total = Math.max(1, term.buffer.active.length);
  const blocks = blocksFor(tab.id).filter((b) => b.promptMarker && b.promptMarker.line >= 0);
  if (blocks.length === 0) return null;

  return (
    <div className="gw-ruler">
      {blocks.map((b) => {
        const cls = blockStatusClass(b);
        const pct = (b.promptMarker!.line / total) * 100;
        return (
          <div
            key={b.id}
            className={`gw-ruler-tick ${cls}`}
            style={{ top: `calc(${pct}% - 6px)` }}
            title={b.command || ''}
            onClick={() => { term.scrollToLine(b.promptMarker!.line); flashBlock(b); }}
          />
        );
      })}
    </div>
  );
};
