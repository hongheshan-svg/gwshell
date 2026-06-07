/**
 * BlockFocusPanel.tsx — right-side panel showing one command's full output.
 * The substitute for "collapse" (xterm can't fold buffer rows). Reuses
 * readOutput(); driven by appStore.focusedBlock.
 */
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { terminalInstances } from './terminalRegistry';
import { blocksFor, readOutput, durationMs } from './blocks';
import { blockCopyOutput, blockRerun, type BlockCtx } from './blockActions';

export const BlockFocusPanel: React.FC = () => {
  const { t } = useTranslation('gwshell');
  const focused = useAppStore((s) => s.focusedBlock);
  const setFocused = useAppStore((s) => s.setFocusedBlock);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocused(null); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [setFocused]);

  if (!focused) return null;
  const inst = terminalInstances.get(focused.tabId);
  const term = inst?.terminal;
  const tab = useAppStore.getState().tabs.find((tb) => tb.id === focused.tabId);
  const block = term ? blocksFor(focused.tabId).find((b) => b.id === focused.blockId) : undefined;
  if (!term || !block || !tab) return null;

  const output = readOutput(focused.tabId, term, block);
  const dur = durationMs(block);
  const ctx: BlockCtx = { tabId: tab.id, tabType: tab.type, sessionId: tab.sessionId };
  const ok = block.state === 'done' && block.exitCode === 0;
  const badgeCls = block.state === 'running' ? 'running' : ok ? 'ok' : 'err';

  return (
    <div className="gw-focus-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setFocused(null); }}>
      <div className="gw-focus-panel">
        <div className="gw-focus-head">
          <span className={`gw-card-badge ${badgeCls}`}>
            {block.state === 'running' ? t('block_running') : ok ? '✓ 0' : '✕ ' + (block.exitCode ?? '?')}
          </span>
          <span className="gw-focus-cmd">{block.command || '—'}</span>
          {dur != null && <span className="gw-focus-meta">{t('focus_duration')}: {dur} ms</span>}
          <button type="button" className="gw-card-btn" onClick={() => setFocused(null)}>✕</button>
        </div>
        <pre className="gw-focus-output">{output || t('focus_empty')}</pre>
        <div className="gw-focus-foot">
          <button type="button" className="gw-card-btn" onClick={() => blockCopyOutput(term, ctx, block)}>{t('block_copy_output')}</button>
          <button type="button" className="gw-card-btn" onClick={() => blockRerun(ctx, block)}>{t('block_rerun')}</button>
        </div>
      </div>
    </div>
  );
};
