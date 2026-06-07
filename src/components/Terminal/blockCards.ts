/**
 * blockCards.ts — finished-command card rendering via xterm decorations.
 *
 * Each finalized block (one whose bottom edge is known because the next
 * prompt has appeared) gets TWO decorations anchored to its prompt marker:
 *   - frame  (layer:'bottom', height = rowSpan, full width): the card box.
 *   - chrome (layer:'top',    height = 1,        full width): badge + toolbar.
 * The trailing/active block is NOT drawn here — BlockLiveFrame (React) owns it.
 */
import type { Terminal } from '@xterm/xterm';
import i18n from '../../i18n';
import { blocksFor, rowSpan, type CommandBlock } from './blocks';
import {
  blockCopyCommand, blockCopyOutput, blockRerun, blockFocus, type BlockCtx,
} from './blockActions';

function applyCardState(el: HTMLElement, block: CommandBlock): void {
  el.classList.add('gw-card');
  el.classList.toggle('running', block.state === 'running');
  el.classList.toggle('ok', block.state === 'done' && block.exitCode === 0);
  el.classList.toggle('err', block.state === 'done' && (block.exitCode ?? 0) !== 0);
}

function buildBadge(block: CommandBlock): HTMLElement {
  const b = document.createElement('span');
  b.className = 'gw-card-badge';
  if (block.exitCode === 0) { b.classList.add('ok'); b.textContent = '✓ 0'; }
  else { b.classList.add('err'); b.textContent = '✕ ' + (block.exitCode ?? '?'); }
  return b;
}

function buildToolbar(term: Terminal, ctx: BlockCtx, block: CommandBlock): HTMLElement {
  const t = (k: string) => i18n.t(`gwshell:${k}` as never) as string;
  const bar = document.createElement('div');
  bar.className = 'gw-card-toolbar';
  const mk = (label: string, on: () => void) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gw-card-btn';
    btn.textContent = label;
    btn.addEventListener('click', (e) => { e.stopPropagation(); on(); });
    return btn;
  };
  bar.appendChild(mk(t('block_copy_cmd'), () => blockCopyCommand(block)));
  bar.appendChild(mk(t('block_copy_output'), () => blockCopyOutput(term, ctx, block)));
  bar.appendChild(mk(t('block_rerun'), () => blockRerun(ctx, block)));
  bar.appendChild(mk(t('block_focus'), () => blockFocus(ctx, block)));
  return bar;
}

function createCard(term: Terminal, ctx: BlockCtx, block: CommandBlock): void {
  if (!block.promptMarker || block.promptMarker.line < 0) return;
  const span = rowSpan(ctx.tabId, term, block);

  const frame = term.registerDecoration({
    marker: block.promptMarker, x: 0, width: term.cols, height: span, layer: 'bottom',
  });
  block.deco = frame ?? null;
  if (frame) frame.onRender((el) => applyCardState(el, block));

  const chrome = term.registerDecoration({
    marker: block.promptMarker, x: 0, width: term.cols, height: 1, layer: 'top',
  });
  block.chromeDeco = chrome ?? null;
  if (chrome) chrome.onRender((el) => {
    if (el.dataset.gwChrome) return;
    el.dataset.gwChrome = '1';
    el.classList.add('gw-card-hdr');
    el.appendChild(buildBadge(block));
    el.appendChild(buildToolbar(term, ctx, block));
  });
}

function disposeCard(block: CommandBlock): void {
  try { block.deco?.dispose(); } catch {}
  try { block.chromeDeco?.dispose(); } catch {}
  block.deco = null;
  block.chromeDeco = null;
}

/** Create finished cards for every block except the trailing active one. */
export function syncCards(term: Terminal, ctx: BlockCtx): void {
  const list = blocksFor(ctx.tabId);
  for (let i = 0; i < list.length - 1; i++) {
    if (!list[i].deco) createCard(term, ctx, list[i]);
  }
}

/** Resize changes row spans → dispose & recreate all finished cards. */
export function rebuildCards(term: Terminal, ctx: BlockCtx): void {
  for (const b of blocksFor(ctx.tabId)) disposeCard(b);
  syncCards(term, ctx);
}
