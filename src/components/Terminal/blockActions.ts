/**
 * blockActions.ts — shared block actions used by both the imperative
 * decoration cards (blockCards.ts) and the React overlays (live frame,
 * focus panel). Keeps copy/rerun/focus logic in one place.
 */
import { invoke } from '@tauri-apps/api/core';
import { writeText as clipboardWrite } from '@tauri-apps/plugin-clipboard-manager';
import type { Terminal } from '@xterm/xterm';
import type { TabInfo } from '../../types';
import { readOutput, type CommandBlock } from './blocks';
import { useAppStore } from '../../stores/appStore';

export interface BlockCtx {
  tabId: string;
  tabType: TabInfo['type'];
  sessionId: string;
}

export function blockCopyCommand(block: CommandBlock): void {
  clipboardWrite(block.command).catch(() => { navigator.clipboard?.writeText(block.command).catch(() => {}); });
}

export function blockCopyOutput(term: Terminal, ctx: BlockCtx, block: CommandBlock): void {
  const out = readOutput(ctx.tabId, term, block);
  clipboardWrite(out).catch(() => { navigator.clipboard?.writeText(out).catch(() => {}); });
}

export function blockRerun(ctx: BlockCtx, block: CommandBlock): void {
  if (!block.command) return;
  const cmd = ctx.tabType === 'ssh' ? 'write_to_ssh'
    : ctx.tabType === 'serial' ? 'write_to_serial'
    : 'write_to_pty';
  invoke(cmd, { sessionId: ctx.sessionId, data: block.command }).catch(() => {});
}

export function blockFocus(ctx: BlockCtx, block: CommandBlock): void {
  useAppStore.getState().setFocusedBlock({ tabId: ctx.tabId, blockId: block.id });
}

/**
 * Status CSS modifier for a block, shared by every card surface so colors
 * agree. Per spec: a `done` block with no exit code (shell emitted bare `D`)
 * is NEUTRAL (no green/red) — only a numeric code colors it.
 */
export function blockStatusClass(block: CommandBlock): 'running' | 'ok' | 'err' | '' {
  if (block.state === 'running') return 'running';
  if (block.exitCode == null) return '';
  return block.exitCode === 0 ? 'ok' : 'err';
}

/** Badge label for a block. `runningLabel` is the i18n "Running…" string. */
export function blockBadgeText(block: CommandBlock, runningLabel: string): string {
  if (block.state === 'running') return runningLabel;
  if (block.exitCode == null) return '·';
  return block.exitCode === 0 ? '✓ 0' : '✕ ' + block.exitCode;
}
