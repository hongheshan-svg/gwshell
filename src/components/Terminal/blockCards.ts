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
  blockCopyCommand, blockCopyOutput, blockRerun, blockFocus,
  blockStatusClass, blockBadgeText, type BlockCtx,
} from './blockActions';

function applyCardState(el: HTMLElement, block: CommandBlock): void {
  el.classList.add('gw-card');
  const s = blockStatusClass(block);
  el.classList.toggle('running', s === 'running');
  el.classList.toggle('ok', s === 'ok');
  el.classList.toggle('err', s === 'err');
}

function buildBadge(block: CommandBlock): HTMLElement {
  const b = document.createElement('span');
  const s = blockStatusClass(block);
  b.className = 'gw-card-badge' + (s ? ' ' + s : '');
  b.textContent = blockBadgeText(block, i18n.t('gwshell:block_running' as never) as string);
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
    // badge + toolbar live in a pointer-events:auto wrapper so the toolbar's
    // hover reveal works (the header itself stays pointer-events:none so the
    // terminal text/selection underneath isn't blocked).
    const actions = document.createElement('div');
    actions.className = 'gw-card-actions';
    actions.appendChild(buildBadge(block));
    actions.appendChild(buildToolbar(term, ctx, block));
    el.appendChild(actions);
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
