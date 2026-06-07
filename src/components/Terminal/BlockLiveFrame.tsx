/**
 * BlockLiveFrame.tsx — React overlay for the single active block.
 *
 * xterm decorations have a fixed height at creation, so the still-growing
 * active command can't be a decoration without per-frame dispose/recreate.
 * Instead we render one absolutely-positioned div, recomputing its pixel
 * rect on every xterm render/scroll. It sits as a sibling of .terminal-pane
 * inside the position:relative .terminal-container. Hidden during alt-buffer.
 */
import React, { useEffect, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import type { TabInfo } from '../../types';
import { terminalInstances } from './terminalRegistry';
import { activeBlock, frameRange } from './blocks';
import {
  blockCopyCommand, blockCopyOutput, blockRerun, blockFocus,
  blockStatusClass, blockBadgeText, type BlockCtx,
} from './blockActions';

export const BlockLiveFrame: React.FC<{ tab: TabInfo }> = ({ tab }) => {
  const { t } = useTranslation('gwshell');
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

  const block = activeBlock(tab.id);
  if (!block || !block.promptMarker || block.promptMarker.line < 0) return null;

  const cellH = term.element && term.rows > 0 ? term.element.clientHeight / term.rows : 0;
  if (cellH <= 0) return null;

  const { start, end } = frameRange(tab.id, term, block);
  const viewportY = term.buffer.active.viewportY;
  const topRows = start - viewportY;
  const spanRows = Math.max(1, end - start);
  const topPx = topRows * cellH;
  const heightPx = spanRows * cellH;
  if (topPx + heightPx <= 0 || topRows >= term.rows) return null; // fully out of view

  const ctx: BlockCtx = { tabId: tab.id, tabType: tab.type, sessionId: tab.sessionId };
  const cls = blockStatusClass(block);
  const badge = blockBadgeText(block, t('block_running'));

  return (
    <div className={`gw-card gw-card-live ${cls}`} style={{ top: `${topPx}px`, height: `${heightPx}px` }}>
      <div className="gw-card-hdr">
        <div className="gw-card-actions">
          <span className={`gw-card-badge ${cls}`}>{badge}</span>
          <div className="gw-card-toolbar">
            <button type="button" className="gw-card-btn" onClick={() => blockCopyCommand(block)}>{t('block_copy_cmd')}</button>
            <button type="button" className="gw-card-btn" onClick={() => blockCopyOutput(term, ctx, block)}>{t('block_copy_output')}</button>
            <button type="button" className="gw-card-btn" onClick={() => blockRerun(ctx, block)}>{t('block_rerun')}</button>
            <button type="button" className="gw-card-btn" onClick={() => blockFocus(ctx, block)}>{t('block_focus')}</button>
          </div>
        </div>
      </div>
    </div>
  );
};
