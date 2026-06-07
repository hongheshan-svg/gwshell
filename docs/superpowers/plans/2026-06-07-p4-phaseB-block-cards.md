# P4 Phase B · 终端 Block 卡片化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Phase A 的 OSC 133 / `CommandBlock` 数据上，把"3px 状态条 + 点击菜单"升级为完整 block 卡片：整卡框、退出码角标、悬停工具条、粘性命令头、overview 刻度尺、聚焦面板，并修复 block 导航快捷键。

**Architecture:** 混合渲染——**已完成 block** 用 xterm decoration 画卡（frame 在 `layer:'bottom'`、header chrome 在 `layer:'top'`，跨度确定后只建一次）；**唯一的活动 block** 用 React overlay（`BlockLiveFrame`）每帧重算像素矩形、平滑长高；**粘性头 / 刻度尺 / 聚焦面板** 是 React。所有 overlay 在 alt-buffer（vim/htop）时隐藏。门控沿用 `cmdHintShellIntegration`，无新设置。

**Tech Stack:** React + TypeScript + Zustand，xterm.js v6（markers + decorations，`allowProposedApi` 已开），Tauri invoke + clipboard 插件，i18next（namespace `gwshell`）。

**测试现实（重要）：** 本项目无自动化测试框架（见 CLAUDE.md）。每个 task 的验证门 = `npm run build`（tsc 类型检查 + vite 构建）+ `npm run smoke:check`，外加**末尾的真 shell 手动验收清单**（卡片需真 shell 发射 OSC 133，运行时表现在用户真机确认，与 Phase A 一致）。因此本计划不写单元测试步骤，改以"完整代码 → build+smoke → commit"为节奏。

**分期（可中途交付）：** Tasks 1–8 = 核心（完成卡 + 活动卡 + 聚焦面板 + 导航修复），自成可用闭环；Tasks 9–10 = 粘性头 + 刻度尺；Task 11 = 收尾验收。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/components/Terminal/blocks.ts` | block 数据模型 + 行区间/跨度/活动块 helper | 修改 |
| `src/components/Terminal/blockActions.ts` | 复制命令/输出、重跑、聚焦（imperative + React 共用） | 新建 |
| `src/components/Terminal/blockCards.ts` | 已完成卡的 decoration 管理（frame + header chrome） | 新建 |
| `src/components/Terminal/BlockLiveFrame.tsx` | 活动 block 的 React overlay 卡 | 新建 |
| `src/components/Terminal/BlockFocusPanel.tsx` | 聚焦面板（单命令全文） | 新建 |
| `src/components/Terminal/BlockStickyHeader.tsx` | 粘性命令头 | 新建 |
| `src/components/Terminal/BlockOverviewRuler.tsx` | 右侧刻度尺 | 新建 |
| `src/components/Terminal/blockNav.ts` | 导航跳转 + 聚焦当前块 + 跳转高亮 | 修改 |
| `src/components/Terminal/TerminalView.tsx` | OSC133 接 `syncCards`；挂载 overlay；移除旧 gutter deco/菜单；终端内导航键 | 修改 |
| `src/keymap/actions.ts` | 新增 `block.focus` 动作 | 修改 |
| `src/stores/appStore.ts` | `focusedBlock` 状态 | 修改 |
| `src/App.tsx` | 根级挂载 `BlockFocusPanel` | 修改 |
| `src/styles/global.css` | `.gw-card*` 样式；移除 `.gw-block-deco`/`.gw-block-menu` | 修改 |
| `src/i18n/locales/gwshell.{en,zh}.json` | 新增文案 | 修改 |

---

## Task 1: 扩展 block 数据模型（`blocks.ts`）

**Files:** Modify `src/components/Terminal/blocks.ts`

- [ ] **Step 1: 给 `CommandBlock` 接口加两个字段**

在 `deco?: IDecoration | null;` 之后加：

```ts
  /** xterm decoration for the top-layer header chrome (badge + toolbar). */
  chromeDeco?: IDecoration | null;
  /** Unix timestamp (ms) when OSC 133 D was received. */
  finishedAt?: number;
```

- [ ] **Step 2: `finishBlock` 记录 `finishedAt`**

把 `finishBlock` 中的赋值改为：

```ts
  if (b) {
    b.state = 'done';
    b.exitCode = exitCode;
    b.finishedAt = Date.now();
  }
```

- [ ] **Step 3: 新增行区间 / 跨度 / 活动块 / 用时 helper**

在文件末尾（`lastRunning` 之前的 Public API 区）追加：

```ts
/** End line (exclusive) of a block's region: the next block's prompt line,
 *  or the buffer end for the trailing/running block. Shared by readOutput,
 *  the card frame span, and the live overlay. */
export function blockEndLine(tabId: string, term: Terminal, block: CommandBlock): number {
  const list = tabBlocks.get(tabId) ?? [];
  const idx = list.indexOf(block);
  const next = idx >= 0 ? list[idx + 1] : undefined;
  const nextLine = next?.promptMarker?.line;
  return (nextLine == null || nextLine < 0) ? term.buffer.active.length : nextLine;
}

/** Frame region [start,end): from the prompt line to the next prompt (or buffer end). */
export function frameRange(tabId: string, term: Terminal, block: CommandBlock): { start: number; end: number } {
  const start = block.promptMarker?.line ?? -1;
  return { start, end: blockEndLine(tabId, term, block) };
}

/** Number of rows the card frame spans (>=1). */
export function rowSpan(tabId: string, term: Terminal, block: CommandBlock): number {
  const { start, end } = frameRange(tabId, term, block);
  return start < 0 ? 1 : Math.max(1, end - start);
}

/** The trailing block not yet finalized into a finished-card decoration:
 *  still running, or done but with no next prompt yet (its bottom edge
 *  is unknown). The React live-frame overlay renders exactly this one. */
export function activeBlock(tabId: string): CommandBlock | undefined {
  const list = tabBlocks.get(tabId);
  if (!list || list.length === 0) return undefined;
  const last = list[list.length - 1];
  if (last.state === 'running') return last;
  if (last.state === 'done' && !last.deco) return last;
  return undefined;
}

/** Elapsed wall-clock for a finished block, ms (undefined while running). */
export function durationMs(block: CommandBlock): number | undefined {
  return block.finishedAt != null ? block.finishedAt - block.startedAt : undefined;
}
```

- [ ] **Step 4: `readOutput` 复用 `blockEndLine`（DRY）**

把 `readOutput` 内计算 `end` 的那段替换为：

```ts
  const start = block.outputMarker?.line;
  if (start == null || start < 0) return '';
  const end = blockEndLine(tabId, term, block);
```

（删掉原本 `const list = ...; const idx = ...; const next = ...; const nextLine = ...; const end = ...` 那几行，循环 `for (let i = start; i < end; i++)` 不变。）

- [ ] **Step 5: 所有 dispose `deco` 的地方一并 dispose `chromeDeco`**

`startBlock` 的孤儿回收里：

```ts
      list.pop();
      prev.promptMarker?.dispose();
      try { prev.deco?.dispose(); } catch {}
      try { prev.chromeDeco?.dispose(); } catch {}
```

`startBlock` 的 `MAX_BLOCKS` 回收 while 里：

```ts
    old?.promptMarker?.dispose();
    old?.outputMarker?.dispose();
    try { old?.deco?.dispose(); } catch {}
    try { old?.chromeDeco?.dispose(); } catch {}
```

`clearTab` 的 forEach 里：

```ts
      b.promptMarker?.dispose();
      b.outputMarker?.dispose();
      try { b.deco?.dispose(); } catch {}
      try { b.chromeDeco?.dispose(); } catch {}
```

- [ ] **Step 6: 构建 + smoke**

Run: `npm run build && npm run smoke:check`
Expected: 通过（仅类型/构建检查；helper 暂未被引用不影响）。

- [ ] **Step 7: Commit**

```bash
git add src/components/Terminal/blocks.ts
git commit -m "feat(blocks): add chromeDeco/finishedAt + frameRange/rowSpan/activeBlock/durationMs helpers"
```

---

## Task 2: `focusedBlock` 状态（`appStore.ts`）

**Files:** Modify `src/stores/appStore.ts`

- [ ] **Step 1: 接口里加状态（紧挨 `setShowTerminalSearch` 之后）**

```ts
  focusedBlock: { tabId: string; blockId: number } | null;
  setFocusedBlock: (v: { tabId: string; blockId: number } | null) => void;
```

- [ ] **Step 2: 实现里加默认值 + setter（紧挨 `setShowTerminalSearch` 实现之后）**

```ts
  focusedBlock: null,
  setFocusedBlock: (v) => set({ focusedBlock: v }),
```

- [ ] **Step 3: 构建 + smoke**

Run: `npm run build && npm run smoke:check`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/stores/appStore.ts
git commit -m "feat(store): add focusedBlock state for block focus panel"
```

---

## Task 3: 卡片样式（`global.css`）

**Files:** Modify `src/styles/global.css`

- [ ] **Step 1: 在 P4 区（现有 `.gw-block-deco` 上方或下方）追加 `.gw-card*` 样式**

```css
/* ========== P4 Phase B · Block cards ========== */
/* Frame decoration (layer:bottom) — border + faint tint + status left edge.
   Renders behind terminal text so the command/output show through. */
.gw-card {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-secondary) 38%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text-primary) 6%, transparent);
  pointer-events: none;
}
.gw-card.running { border-left: 2px solid var(--accent-primary); }
.gw-card.ok     { border-left: 2px solid var(--success); }
.gw-card.err    { border-left: 2px solid var(--danger); }

/* Header chrome (layer:top, 1 row) — transparent container, right-aligned
   badge + hover toolbar. pointer-events none so terminal selection still works;
   only the buttons capture clicks. */
.gw-card-hdr {
  display: flex; align-items: center; justify-content: flex-end;
  gap: 6px; padding: 0 8px; pointer-events: none;
}
.gw-card-badge {
  font-size: 10.5px; font-weight: 600; line-height: 1.4;
  padding: 0 7px; border-radius: var(--radius-pill); white-space: nowrap;
}
.gw-card-badge.ok      { background: color-mix(in srgb, var(--success) 16%, transparent); color: var(--success); }
.gw-card-badge.err     { background: color-mix(in srgb, var(--danger) 18%, transparent);  color: var(--danger); }
.gw-card-badge.running { background: color-mix(in srgb, var(--accent-primary) 16%, transparent); color: var(--accent-primary); }

.gw-card-toolbar { display: none; gap: 4px; pointer-events: auto; }
.gw-card-hdr:hover .gw-card-toolbar,
.gw-card-live:hover .gw-card-toolbar { display: flex; }
.gw-card-btn {
  font-size: 11px; padding: 1px 7px; border: 1px solid var(--border-color);
  border-radius: var(--radius-sm); background: var(--bg-secondary);
  color: var(--text-primary); cursor: pointer; white-space: nowrap; pointer-events: auto;
}
.gw-card-btn:hover { background: var(--bg-hover, var(--accent-bg)); }

/* Live overlay card (React) — absolutely positioned inside .terminal-container. */
.gw-card-live {
  position: absolute; left: 0; right: 0; z-index: 4;
  border: 1px solid var(--border-color); border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-secondary) 30%, transparent);
  pointer-events: none;
}
.gw-card-live.running { border-left: 2px solid var(--accent-primary); border-bottom-style: dashed; }
.gw-card-live.ok { border-left: 2px solid var(--success); }
.gw-card-live.err { border-left: 2px solid var(--danger); }
.gw-card-live .gw-card-hdr { height: var(--cell-h, 17px); }

/* Brief highlight when navigated to. */
.gw-card-flash { animation: gwCardFlash .7s ease-out; }
@keyframes gwCardFlash { from { background: color-mix(in srgb, var(--accent-primary) 22%, transparent); } }

/* Sticky command header (Task 9). */
.gw-sticky {
  position: absolute; top: 0; left: 0; right: 0; z-index: 6;
  display: flex; align-items: center; gap: 8px;
  padding: 4px 10px; font-size: 12px;
  background: var(--surface-blur, color-mix(in srgb, var(--bg-secondary) 92%, transparent));
  backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--border-color); cursor: pointer;
}
.gw-sticky-cmd { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Overview ruler (Task 10). */
.gw-ruler { position: absolute; top: 0; right: 0; bottom: 0; width: 8px; z-index: 5; pointer-events: none; }
.gw-ruler-tick { position: absolute; right: 1px; width: 4px; height: 12px; border-radius: 2px; cursor: pointer; pointer-events: auto; opacity: .75; }
.gw-ruler-tick:hover { opacity: 1; }
.gw-ruler-tick.running { background: var(--accent-primary); }
.gw-ruler-tick.ok { background: var(--success); }
.gw-ruler-tick.err { background: var(--danger); }

/* Focus panel (Task 7). */
.gw-focus-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; justify-content: flex-end; background: color-mix(in srgb, #000 28%, transparent); }
.gw-focus-panel { width: min(560px, 92vw); height: 100%; display: flex; flex-direction: column; background: var(--bg-primary); border-left: 1px solid var(--border-color); box-shadow: var(--shadow-lg); }
.gw-focus-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--border-color); }
.gw-focus-cmd { font-family: var(--font-mono); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.gw-focus-meta { color: var(--text-secondary); font-size: 11px; }
.gw-focus-output { flex: 1; margin: 0; padding: 12px 14px; overflow: auto; font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6; color: var(--text-primary); white-space: pre-wrap; word-break: break-word; }
.gw-focus-foot { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border-color); }
```

- [ ] **Step 2: 构建 + smoke**

Run: `npm run build && npm run smoke:check`
Expected: 通过（纯 CSS，不影响类型）。

- [ ] **Step 3: Commit**

```bash
git add src/styles/global.css
git commit -m "feat(styles): add .gw-card* block-card styles (frame/header/badge/toolbar/sticky/ruler/focus)"
```

> 注：旧 `.gw-block-deco` / `.gw-block-menu` 暂保留，待 Task 8 移除旧代码时一并删。

---

## Task 4: 共用动作（`blockActions.ts`，新建）

**Files:** Create `src/components/Terminal/blockActions.ts`

- [ ] **Step 1: 写文件**

```ts
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
```

> 若 `invoke` 在本仓库实际从别处导入（Phase A 用法见 `TerminalView.tsx`），以那里的导入路径为准；`@tauri-apps/api/core` 是 Tauri v2 标准路径。

- [ ] **Step 2: 构建 + smoke**

Run: `npm run build && npm run smoke:check`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add src/components/Terminal/blockActions.ts
git commit -m "feat(blocks): shared blockActions (copy cmd/output, rerun, focus)"
```

---

## Task 5: 完成卡 decoration 管理（`blockCards.ts`，新建）

**Files:** Create `src/components/Terminal/blockCards.ts`

- [ ] **Step 1: 写文件**

```ts
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
```

> `i18n` 默认导出用法与 Phase A `openBlockMenu`（`i18n.t('gwshell:...')`）一致；若实际导入名不同，沿用 `TerminalView.tsx` 顶部的 i18n 导入。

- [ ] **Step 2: 构建 + smoke**

Run: `npm run build && npm run smoke:check`
Expected: 通过（模块导出但暂未被 TerminalView 引用）。

- [ ] **Step 3: Commit**

```bash
git add src/components/Terminal/blockCards.ts
git commit -m "feat(blocks): finished-card decorations (frame + header chrome)"
```

---

## Task 6: 活动卡 overlay（`BlockLiveFrame.tsx`，新建）

**Files:** Create `src/components/Terminal/BlockLiveFrame.tsx`

- [ ] **Step 1: 写文件**

```tsx
/**
 * BlockLiveFrame.tsx — React overlay for the single active block.
 *
 * xterm decorations have a fixed height at creation, so the still-growing
 * active command can't be a decoration without per-frame dispose/recreate.
 * Instead we render one absolutely-positioned div, recomputing its pixel
 * rect on every xterm render/scroll. It sits as a sibling of .terminal-pane
 * inside the position:relative .terminal-container. Hidden during alt-buffer.
 */
import { useEffect, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import type { TabInfo } from '../../types';
import { terminalInstances } from './terminalRegistry';
import { activeBlock, frameRange, type CommandBlock } from './blocks';
import {
  blockCopyCommand, blockCopyOutput, blockRerun, blockFocus, type BlockCtx,
} from './blockActions';

function statusClass(block: CommandBlock): string {
  if (block.state === 'running') return 'running';
  return block.exitCode === 0 ? 'ok' : 'err';
}

export function BlockLiveFrame({ tab }: { tab: TabInfo }): JSX.Element | null {
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
  const cls = statusClass(block);
  const badge = block.state === 'running' ? t('block_running')
    : block.exitCode === 0 ? '✓ 0' : '✕ ' + (block.exitCode ?? '?');

  return (
    <div className={`gw-card gw-card-live ${cls}`} style={{ top: `${topPx}px`, height: `${heightPx}px` }}>
      <div className="gw-card-hdr">
        <span className={`gw-card-badge ${cls}`}>{badge}</span>
        <div className="gw-card-toolbar">
          <button type="button" className="gw-card-btn" onClick={() => blockCopyCommand(block)}>{t('block_copy_cmd')}</button>
          <button type="button" className="gw-card-btn" onClick={() => blockCopyOutput(term, ctx, block)}>{t('block_copy_output')}</button>
          <button type="button" className="gw-card-btn" onClick={() => blockRerun(ctx, block)}>{t('block_rerun')}</button>
          <button type="button" className="gw-card-btn" onClick={() => blockFocus(ctx, block)}>{t('block_focus')}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 构建 + smoke**

Run: `npm run build && npm run smoke:check`
Expected: 通过（组件导出，暂未挂载）。若 `JSX.Element` 类型报错，改用 `import type { ReactElement } from 'react'` 返回 `ReactElement | null`。

- [ ] **Step 3: Commit**

```bash
git add src/components/Terminal/BlockLiveFrame.tsx
git commit -m "feat(blocks): BlockLiveFrame React overlay for the active block"
```

---

## Task 7: 聚焦面板（`BlockFocusPanel.tsx`）+ i18n + App 挂载

**Files:** Create `src/components/Terminal/BlockFocusPanel.tsx`; Modify `src/App.tsx`, `src/i18n/locales/gwshell.en.json`, `src/i18n/locales/gwshell.zh.json`

- [ ] **Step 1: 加 i18n 文案（en）**

在 `"block_rerun": "Re-run",` 之后加：

```json
  "block_focus": "Focus",
  "block_running": "Running…",
  "action_block_focus": "Focus command",
  "focus_output": "Output",
  "focus_empty": "No output captured",
  "focus_duration": "Duration",
```

- [ ] **Step 2: 加 i18n 文案（zh，键集必须与 en 一致）**

在 zh 文件对应 `"block_rerun"` 之后加：

```json
  "block_focus": "聚焦",
  "block_running": "运行中…",
  "action_block_focus": "聚焦命令",
  "focus_output": "输出",
  "focus_empty": "无输出",
  "focus_duration": "用时",
```

- [ ] **Step 3: 写 `BlockFocusPanel.tsx`**

```tsx
/**
 * BlockFocusPanel.tsx — right-side panel showing one command's full output.
 * The substitute for "collapse" (xterm can't fold buffer rows). Reuses
 * readOutput(); driven by appStore.focusedBlock.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { terminalInstances } from './terminalRegistry';
import { blocksFor, readOutput, durationMs } from './blocks';
import { blockCopyOutput, blockRerun, type BlockCtx } from './blockActions';

export function BlockFocusPanel(): JSX.Element | null {
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
  if (!term || !block || !tab) { return null; }

  const output = readOutput(focused.tabId, term, block);
  const dur = durationMs(block);
  const ctx: BlockCtx = { tabId: tab.id, tabType: tab.type, sessionId: tab.sessionId };
  const ok = block.state === 'done' && block.exitCode === 0;

  return (
    <div className="gw-focus-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setFocused(null); }}>
      <div className="gw-focus-panel">
        <div className="gw-focus-head">
          <span className={`gw-card-badge ${block.state === 'running' ? 'running' : ok ? 'ok' : 'err'}`}>
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
}
```

- [ ] **Step 4: App.tsx 挂载**

在其它 lazy 导入旁加：

```ts
const BlockFocusPanel = lazy(() => import('./components/Terminal/BlockFocusPanel').then((m) => ({ default: m.BlockFocusPanel })));
```

在 App 的 store 选择器里加 `focusedBlock`（与 `showTerminalSearch` 等并列）：

```ts
  const focusedBlock = useAppStore((s) => s.focusedBlock);
```

在根级模态挂载区（如 `{showNewSession && <NewSessionModal />}` 附近）加：

```tsx
          {focusedBlock && <Suspense fallback={null}><BlockFocusPanel /></Suspense>}
```

- [ ] **Step 5: 构建 + smoke**

Run: `npm run build && npm run smoke:check`
Expected: 通过。打开应用，从命令面板/任意入口暂时无法触发（下个 task 接线），但编译通过。

- [ ] **Step 6: Commit**

```bash
git add src/components/Terminal/BlockFocusPanel.tsx src/App.tsx src/i18n/locales/gwshell.en.json src/i18n/locales/gwshell.zh.json
git commit -m "feat(blocks): block focus panel + i18n + App mount"
```

---

## Task 8: TerminalView 接线 + 导航修复 + 移除旧表现

**Files:** Modify `src/components/Terminal/TerminalView.tsx`, `src/components/Terminal/blockNav.ts`, `src/keymap/actions.ts`, `src/styles/global.css`

- [ ] **Step 1: blockNav.ts — 加"聚焦视口块"和"跳转高亮"**

在 `blockNav.ts` 末尾追加，并在 `scrollToAdjacentBlock` 跳转后调用 `flashBlock`：

```ts
import { blockFocus } from './blockActions';
import type { CommandBlock } from './blocks';

/** Add a brief highlight to a block's card decoration element, if present. */
export function flashBlock(block: CommandBlock): void {
  const el = block.deco?.element;
  if (!el) return;
  el.classList.add('gw-card-flash');
  setTimeout(() => { try { el.classList.remove('gw-card-flash'); } catch {} }, 700);
}

/** Focus the block whose prompt is at/above the current viewport top. */
export function focusViewportBlock(): void {
  const { activeTabId, tabs } = useAppStore.getState();
  if (!activeTabId) return;
  const inst = terminalInstances.get(activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!inst || !tab) return;
  const term = inst.terminal;
  const viewportY = term.buffer.active.viewportY;
  const blocks = blocksFor(activeTabId).filter((b) => b.promptMarker && b.promptMarker.line >= 0);
  let target = blocks[0];
  for (const b of blocks) { if (b.promptMarker!.line <= viewportY) target = b; }
  if (target) blockFocus({ tabId: tab.id, tabType: tab.type, sessionId: tab.sessionId }, target);
}
```

并在 `scrollToAdjacentBlock` 两处 `term.scrollToLine(...)` 成功跳转后，找到目标 block 调 `flashBlock(target)`（`dir===-1` 分支用记录的 `target` 块对象；`dir===1` 分支用命中的 `b`）。具体：把两处分支改成先拿到 block 对象再 `scrollToLine` + `flashBlock`。

- [ ] **Step 2: actions.ts — 新增 `block.focus` 动作**

在 import 区加 `focusViewportBlock`：

```ts
import { scrollToAdjacentBlock, focusViewportBlock } from '../components/Terminal/blockNav';
```

在 `block.next` 之后加一行动作：

```ts
  { id: 'block.focus', labelKey: 'action_block_focus', defaultBinding: IS_MACOS ? 'Meta+Shift+Enter' : 'Ctrl+Shift+Enter', run: () => focusViewportBlock() },
```

- [ ] **Step 3: TerminalView — 顶部导入**

```ts
import { syncCards, rebuildCards } from './blockCards';
import { BlockLiveFrame } from './BlockLiveFrame';
import type { BlockCtx } from './blockActions';
import { resolveBindings } from '../../keymap/dispatch';
import { matchStep } from '../../keymap/match';
import { ACTION_BY_ID } from '../../keymap/actions';
```

并删除现在不再用的 `readOutput`（若仅被旧菜单用到则保留——检查后再删）。**保留** `blocksFor`/`startBlock`/`markOutput`/`setCommand`/`finishBlock`/`clearTab` 导入。

- [ ] **Step 4: TerminalView — OSC133 handler 接 syncCards、删旧 deco**

在 `kind === 'A'` 分支创建 block 之后追加（finalize 上一块）。直接用 handler 内已有的 `term133`，不要新建 `term` 局部（避免遮蔽）：

```ts
          syncCards(term133, { tabId: tab.id, tabType: tab.type, sessionId: tab.sessionId });
```

在 `kind === 'C'` 分支：**删除**创建 gutter decoration 的整段（现 `if (cblock && cblock.promptMarker && !cblock.deco) { const deco = term133.registerDecoration(...); ... }`）。保留 `markOutput`/`setCommand` 调用与历史记录逻辑。

在 `kind === 'D'` 分支：**删除**旧的 `if (finished?.deco) { const repaint = ...; repaint(); requestAnimationFrame(repaint); setTimeout(repaint, 50); }` 整段。`finishBlock` 调用保留。

- [ ] **Step 5: TerminalView — resize 时 rebuildCards**

在 `instance!.terminal.onResize(({ rows, cols }) => { ... })` 回调体内（`resizeCmd` 那个）末尾追加：

```ts
          try { rebuildCards(instance!.terminal, { tabId: tab.id, tabType: tab.type, sessionId: tab.sessionId }); } catch {}
```

（若该 `onResize` 仅在 `resizeCmd` 存在时注册，对无 resizeCmd 的 tab 影响不大；卡片主要用于可注入 OSC133 的交互终端，均有 resizeCmd。）

- [ ] **Step 6: TerminalView — 自定义键处理里加 block 导航/聚焦**

在 `attachCustomKeyEventHandler` 回调内、`if (isCopyShortcut(e)) {` 之前插入：

```ts
          // Block navigation / focus — handle at the terminal level so a focused
          // terminal doesn't swallow the chord (fixes the Phase A ⌘⇧↑/↓ leftover:
          // the window-level dispatcher bails on defaultPrevented).
          {
            const overrides = useSettingsStore.getState().settings.keymapOverrides ?? {};
            for (const b of resolveBindings(overrides)) {
              if ((b.actionId === 'block.prev' || b.actionId === 'block.next' || b.actionId === 'block.focus')
                  && b.chord.length === 1 && matchStep(e, b.chord[0])) {
                e.preventDefault();
                ACTION_BY_ID.get(b.actionId)?.run();
                return false;
              }
            }
          }
```

- [ ] **Step 7: TerminalView — 删除旧 block 菜单代码**

删除 Phase A 的 `applyBlockDecoClass`、`activeBlockMenu`、`closeBlockMenu`、`openBlockMenu` 四个函数定义（约 179–291 行区域），以及任何对它们的残留引用（应只剩被删的 'C' 分支用过）。

- [ ] **Step 8: TerminalView — JSX 挂载 BlockLiveFrame**

在 ghost overlay `<div className="terminal-ghost-text">...` 块之后加：

```tsx
      {isActive && isInteractiveTerminal(tab.type) && <BlockLiveFrame tab={tab} />}
```

- [ ] **Step 9: global.css — 删除旧样式**

删除 `.gw-block-deco` 系列与 `.gw-block-menu` / `.gw-block-menu-item` 样式块（Task 3 的 `.gw-card*` 取而代之）。

- [ ] **Step 10: 构建 + smoke**

Run: `npm run build && npm run smoke:check`
Expected: 通过；无对已删函数的悬空引用。

- [ ] **Step 11: Commit**

```bash
git add src/components/Terminal/TerminalView.tsx src/components/Terminal/blockNav.ts src/keymap/actions.ts src/styles/global.css
git commit -m "feat(terminal): wire block cards (syncCards/live frame), fix block nav keys, add block.focus, remove Phase A gutter bar + menu"
```

---

## Task 9: 粘性命令头（`BlockStickyHeader.tsx`）

**Files:** Create `src/components/Terminal/BlockStickyHeader.tsx`; Modify `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: 写 `BlockStickyHeader.tsx`**

```tsx
/**
 * BlockStickyHeader.tsx — pins the command of the block currently occupying
 * the top of the viewport (VS Code "sticky scroll"). Click = focus that block.
 * Hidden during alt-buffer and when the top row isn't inside a block region.
 */
import { useEffect, useReducer } from 'react';
import type { TabInfo } from '../../types';
import { terminalInstances } from './terminalRegistry';
import { blocksFor, frameRange } from './blocks';
import { blockFocus, type BlockCtx } from './blockActions';

export function BlockStickyHeader({ tab }: { tab: TabInfo }): JSX.Element | null {
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

  const viewportY = term.buffer.active.viewportY;
  const top = viewportY;
  const blocks = blocksFor(tab.id);
  // The block whose region contains the top viewport row.
  let current = null as (typeof blocks)[number] | null;
  for (const b of blocks) {
    const { start, end } = frameRange(tab.id, term, b);
    if (start >= 0 && start <= top && top < end) { current = b; }
  }
  if (!current || current.promptMarker?.line === top) return null; // don't shadow the real prompt row

  const ctx: BlockCtx = { tabId: tab.id, tabType: tab.type, sessionId: tab.sessionId };
  const ok = current.state === 'done' && current.exitCode === 0;
  const badge = current.state === 'running' ? '…' : ok ? '✓ 0' : '✕ ' + (current.exitCode ?? '?');
  const cls = current.state === 'running' ? 'running' : ok ? 'ok' : 'err';

  return (
    <div className="gw-sticky" onMouseDown={() => blockFocus(ctx, current!)}>
      <span className={`gw-card-badge ${cls}`}>{badge}</span>
      <span className="gw-sticky-cmd">{current.command || '—'}</span>
    </div>
  );
}
```

- [ ] **Step 2: TerminalView 挂载**

导入：

```ts
import { BlockStickyHeader } from './BlockStickyHeader';
```

在 `<BlockLiveFrame .../>` 旁加：

```tsx
      {isActive && isInteractiveTerminal(tab.type) && <BlockStickyHeader tab={tab} />}
```

- [ ] **Step 3: 构建 + smoke**

Run: `npm run build && npm run smoke:check`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/components/Terminal/BlockStickyHeader.tsx src/components/Terminal/TerminalView.tsx
git commit -m "feat(blocks): sticky command header overlay"
```

---

## Task 10: Overview 刻度尺（`BlockOverviewRuler.tsx`）

**Files:** Create `src/components/Terminal/BlockOverviewRuler.tsx`; Modify `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: 写 `BlockOverviewRuler.tsx`**

```tsx
/**
 * BlockOverviewRuler.tsx — right-edge minimap: one colored tick per block,
 * positioned by promptMarker.line / total buffer length. Click = scroll there.
 * Custom (not xterm overviewRulerOptions) so clicks can jump to the block.
 */
import { useEffect, useReducer } from 'react';
import type { TabInfo } from '../../types';
import { terminalInstances } from './terminalRegistry';
import { blocksFor, flashBlockById } from './blocks';

export function BlockOverviewRuler({ tab }: { tab: TabInfo }): JSX.Element | null {
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
        const cls = b.state === 'running' ? 'running' : b.exitCode === 0 ? 'ok' : 'err';
        const pct = (b.promptMarker!.line / total) * 100;
        return (
          <div
            key={b.id}
            className={`gw-ruler-tick ${cls}`}
            style={{ top: `calc(${pct}% - 6px)` }}
            title={b.command || ''}
            onClick={() => { term.scrollToLine(b.promptMarker!.line); flashBlockById(tab.id, b.id); }}
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: blocks.ts — 加 `flashBlockById`（供 ruler 点击高亮，避免循环依赖）**

在 `blocks.ts` 末尾 Public API 区加：

```ts
/** Briefly highlight a block's card decoration element by id (used by the ruler). */
export function flashBlockById(tabId: string, blockId: number): void {
  const block = (tabBlocks.get(tabId) ?? []).find((b) => b.id === blockId);
  const el = block?.deco?.element;
  if (!el) return;
  el.classList.add('gw-card-flash');
  setTimeout(() => { try { el.classList.remove('gw-card-flash'); } catch {} }, 700);
}
```

- [ ] **Step 3: TerminalView 挂载**

导入：

```ts
import { BlockOverviewRuler } from './BlockOverviewRuler';
```

在 sticky/live 旁加：

```tsx
      {isActive && isInteractiveTerminal(tab.type) && <BlockOverviewRuler tab={tab} />}
```

- [ ] **Step 4: 构建 + smoke**

Run: `npm run build && npm run smoke:check`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/Terminal/BlockOverviewRuler.tsx src/components/Terminal/blocks.ts src/components/Terminal/TerminalView.tsx
git commit -m "feat(blocks): overview ruler with click-to-jump"
```

---

## Task 11: 真 shell 验收 + 收尾

**Files:** 无（验收）；如发现问题再回到对应 task。

- [ ] **Step 1: 全量构建 + smoke + Rust 构建**

Run: `npm run build && npm run smoke:check && (cd src-tauri && cargo build)`
Expected: 全绿。

- [ ] **Step 2: 真机手动验收（需真 shell）**

启动 `npm run tauri dev`，开本地 bash/zsh 终端，设置里打开 shell 集成（`cmdHintShellIntegration`），逐项确认：

- [ ] 每条已完成命令框成卡：圆角边框 + 状态左边线（绿/红）+ 右上退出码角标（`✓ 0` / `✕ N`）。
- [ ] 运行中命令显示"活动卡"（虚线底/运行角标），输出增长平滑、无闪烁；命令结束并出现下一个 prompt 后，无缝变成完成卡。
- [ ] 卡片头 hover 出工具条：复制命令 / 复制输出 / 重跑 / 聚焦 均生效。
- [ ] 点"聚焦" → 右侧面板显示该命令全文 + 退出码 + 用时；Esc / 点遮罩 / ✕ 关闭。
- [ ] 长输出滚动时顶部出现粘性命令头，显示当前命令；点它聚焦。
- [ ] 右侧刻度尺逐命令着色，点击跳转到对应命令并短暂高亮。
- [ ] `⌘⇧↑` / `⌘⇧↓`（终端聚焦时）跳转上一条/下一条命令并高亮；`⌘⇧Enter` 聚焦当前命令。
- [ ] 进入 `vim` / `htop`（alt-buffer）后所有卡片/overlay 消失，退出后恢复。
- [ ] 关闭 shell 集成 → 完全恢复普通终端（无卡、无 overlay、无刻度尺）。
- [ ] 回归：命令历史、ghost 补全、退出码解析仍正常。

- [ ] **Step 3: 更新记忆（terminal-blocks-p4.md）**

把 Phase B 完成情况补进 `[[terminal-blocks-p4]]` 记忆（或新建 `terminal-block-cards-p4b`），记录混合渲染架构与真机验收结论。

- [ ] **Step 4: 收尾分支**

使用 `superpowers:finishing-a-development-branch` 技能合并/开 PR。

---

## Self-Review

**Spec 覆盖核对（spec §4 A1–A9）：**
- A1 数据模型 → Task 1 ✅
- A2 完成卡管理 → Task 5 ✅
- A3 运行中 overlay → Task 6 ✅
- A4 粘性命令头 → Task 9 ✅
- A5 overview 刻度尺 → Task 10 ✅
- A6 悬停工具条 → Task 4（动作）+ Task 5（完成卡工具条）+ Task 6（活动卡工具条）✅
- A7 聚焦面板 → Task 2（store）+ Task 7 ✅
- A8 样式 → Task 3（加）+ Task 8 Step 9（删旧）✅
- A9 导航修复 + block.focus → Task 8 Steps 1/2/6 ✅
- 门控无新设置 → 全程复用 `cmdHintShellIntegration`，未改 AppSettings ✅

**占位符扫描：** 无 TBD/TODO；所有代码步给出完整代码。

**类型一致性核对：**
- `CommandBlock` 新字段 `chromeDeco`/`finishedAt`（Task 1）→ 被 Task 5/blocks 用到，一致。
- `BlockCtx { tabId, tabType, sessionId }`（Task 4）→ Task 5/6/7/8/9 一致使用。
- `syncCards(term, ctx)` / `rebuildCards(term, ctx)`（Task 5）→ Task 8 调用签名一致。
- `frameRange`/`rowSpan`/`activeBlock`/`durationMs`/`blockEndLine`/`flashBlockById`（Task 1/10）→ 各 overlay 引用一致。
- `focusedBlock: { tabId, blockId }`（Task 2）→ Task 7/blockActions `setFocusedBlock` 一致。
- i18n 键 `block_focus`/`block_running`/`action_block_focus`/`focus_output`/`focus_empty`/`focus_duration`（Task 7）→ Task 6/7/9 引用，en+zh 同步。

**已知取舍（写入 spec §6，非缺口）：** 活动卡 overlay 每帧 `onRender` 触发一次 React 重渲（单组件，必要时 rAF 节流）；私有 `term.element.clientHeight/rows` 求 cellH（DOM 公开属性，较 `_renderService` 稳）。
