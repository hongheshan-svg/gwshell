# P3 命令优先导航 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** 把弱命令面板重写为 ⌘K 命令中枢——搜会话/切标签/执行所有 keymap 动作/发起创建导航，分组展示；titlebar 中央放 ⌘K 入口药丸；侧栏轻度降级保留。

**Architecture:** 新增统一命令模型 `commands.ts`（buildCommands 聚合 keymap 动作 + 创建/导航 + 会话 + 标签）；重写 `CommandPalette.tsx` 消费之；`palette.open` 按平台重绑 ⌘K（抽 `lib/platform.ts` 共享 IS_MACOS）；TitleBar 中央加药丸。全部走 P1 令牌。

**Tech Stack:** React/TS + Zustand；既有 keymap（`src/keymap/*`）。

**测试现实:** 无自动化测试。每 task 验收 = `npm run build` + `npm run smoke:check` + 浏览器桩截图（[[preview-tauri-app-in-browser]]）+ 人工。

**参考 spec:** `docs/superpowers/specs/2026-06-07-p3-command-first-nav-design.md`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/lib/platform.ts` | 新增：导出 `IS_MACOS`（TitleBar 与 actions 共用） |
| `src/components/CommandPalette/commands.ts` | 新增：`Command` 类型 + `buildCommands(ctx)` |
| `src/components/CommandPalette/CommandPalette.tsx` | 重写：分组/过滤/键盘/图标/hint |
| `src/keymap/actions.ts` | `palette.open` 重绑 ⌘K（按平台） |
| `src/components/TitleBar/TitleBar.tsx` | 中央 ⌘K 药丸；改用 `lib/platform` |
| `src/styles/global.css` | `.command-palette-*` 增强 + `.titlebar-cmdk` |
| `src/i18n/locales/gwshell.{en,zh}.json` | 文案 |

---

## Task 1: 抽 `lib/platform.ts`（共享 IS_MACOS）

**Files:** Create `src/lib/platform.ts`; Modify `src/components/TitleBar/TitleBar.tsx`

- [ ] **Step 1: 创建 platform.ts**

Read `TitleBar.tsx:14` 看现有 IS_MACOS 的判定表达式，原样搬入：
```ts
// src/lib/platform.ts
export const IS_MACOS =
  typeof navigator !== 'undefined' &&
  /mac/i.test(navigator.platform || (navigator as any).userAgentData?.platform || '');
```
（用 TitleBar 里**实际的**判定式，保持一致。）

- [ ] **Step 2: TitleBar 改用共享常量**

`TitleBar.tsx`：删除本地 `const IS_MACOS = ...`，改 `import { IS_MACOS } from '../../lib/platform';`。其余用法不变。

- [ ] **Step 3: 验证 + Commit**

Run: `npm run build`（分类器可能间歇挡 npm/node；若挡则据读校验，勿超 ~2 次重试）。
```bash
git add src/lib/platform.ts src/components/TitleBar/TitleBar.tsx
git commit -m "refactor: extract IS_MACOS to lib/platform (P3)"
```

---

## Task 2: 命令模型 `commands.ts`

**Files:** Create `src/components/CommandPalette/commands.ts`

- [ ] **Step 1: 读依赖**

Read：`src/keymap/actions.ts`（`KEY_ACTIONS` 形状：`{id,labelKey,defaultBinding,run}`）、`src/keymap/match.ts`（`parseBinding`、`formatStep`）、`src/components/Sidebar/NewAssetMenu.tsx`（创建类触发的 store 方法名：新建/快连/本地终端等）、`src/stores/appStore.ts`（`setShowNewSession`/`setShowQuickConnect`/`setShowLocalTerminal`/`setActiveTab`/`toggleSidebar`/`addTab` 等真实方法名）、`src/stores/settingsStore.ts`（theme 在 settings；切换用 `save({...settings, theme})` 或 appStore.setTheme——确认）。

- [ ] **Step 2: 定义类型 + buildCommands**

```ts
import type { LucideIcon } from 'lucide-react';
import { Settings, Plus, Terminal, Zap, Home, Sun, PanelLeft, Search, Radio, X, ArrowLeftRight } from 'lucide-react';
import { KEY_ACTIONS } from '../../keymap/actions';
import { parseBinding, formatStep } from '../../keymap/match';
import type { SessionConfig, TabInfo } from '../../types';

export interface Command {
  id: string;
  group: 'action' | 'create' | 'session' | 'tab';
  label: string;
  sub?: string;
  hint?: string;
  keywords?: string;
  icon?: LucideIcon;
  run: () => void;
}

function fmtBinding(binding?: string): string | undefined {
  if (!binding) return undefined;
  const chord = parseBinding(binding);
  if (!chord) return undefined;
  return chord.map(formatStep).join(' ');
}

export interface CommandCtx {
  sessions: SessionConfig[];
  tabs: TabInfo[];
  keymapOverrides: Record<string, string | null>;
  t: (k: string, d?: string) => string;
  // store actions:
  addTab: (t: TabInfo) => void;
  setActiveTab: (id: string) => void;
  setShowNewSession: (b: boolean) => void;
  setShowQuickConnect: (b: boolean) => void;
  setShowLocalTerminal: (b: boolean) => void;
  setShowSettings: (b: boolean) => void;
  toggleSidebar: () => void;
  toggleTheme: () => void;
}

export function buildCommands(ctx: CommandCtx): Command[] {
  const cmds: Command[] = [];

  // 1) keymap actions (exclude palette.open itself)
  for (const a of KEY_ACTIONS) {
    if (a.id === 'palette.open') continue;
    const binding = ctx.keymapOverrides[a.id] ?? a.defaultBinding;
    cmds.push({
      id: `action:${a.id}`, group: 'action',
      label: ctx.t(a.labelKey), hint: fmtBinding(binding),
      icon: iconForAction(a.id), run: a.run,
    });
  }

  // 2) create / navigate
  cmds.push(
    { id:'create:ssh', group:'create', label: ctx.t('cmd_new_ssh','New SSH'), icon: Plus, run: () => ctx.setShowNewSession(true) },
    { id:'create:local', group:'create', label: ctx.t('cmd_new_local','New local terminal'), icon: Terminal, run: () => ctx.setShowLocalTerminal(true) },
    { id:'create:quick', group:'create', label: ctx.t('cmd_quick_connect','Quick connect'), icon: Zap, run: () => ctx.setShowQuickConnect(true) },
    { id:'nav:home', group:'create', label: ctx.t('cmd_open_home','Open home'), icon: Home, run: () => ctx.setActiveTab('asset-list') },
    { id:'nav:theme', group:'create', label: ctx.t('cmd_toggle_theme','Toggle theme'), icon: Sun, run: ctx.toggleTheme },
    { id:'nav:sidebar', group:'create', label: ctx.t('cmd_toggle_sidebar','Toggle sidebar'), icon: PanelLeft, run: ctx.toggleSidebar },
  );

  // 3) sessions (connect)
  for (const s of ctx.sessions) {
    if (s._temporary) continue;
    cmds.push({
      id:`session:${s.id}`, group:'session', label: s.name, sub: s.host ?? s.session_type,
      keywords: `${s.host ?? ''} ${s.username ?? ''}`, icon: Search,
      run: () => {
        const existing = ctx.tabs.find((tb) => tb.sessionId === s.id);
        if (existing) ctx.setActiveTab(existing.id);
        else ctx.addTab({ id: crypto.randomUUID(), sessionId: s.id, title: s.name, type: s.session_type, connected: false });
      },
    });
  }

  // 4) open tabs (switch)
  for (const tb of ctx.tabs) {
    if (tb.type === 'asset-list') continue;
    cmds.push({ id:`tab:${tb.id}`, group:'tab', label: tb.title, sub: tb.type, icon: ArrowLeftRight, run: () => ctx.setActiveTab(tb.id) });
  }

  return cmds;
}

function iconForAction(id: string): LucideIcon {
  if (id.startsWith('settings')) return Settings;
  if (id.startsWith('terminal')) return Search;
  if (id.startsWith('broadcast')) return Radio;
  if (id === 'tab.close') return X;
  return ArrowLeftRight; // tab.next/prev
}
```
（**确认** ctx 里的方法名/是否存在与 store 一致；`toggleTheme` 若 store 无现成方法，在组件里实现成读 settings.theme 取反并 `save`/`setTheme`。`setShowLocalTerminal`/`setShowQuickConnect` 若名字不同，按 NewAssetMenu 实际用法改。）

- [ ] **Step 3: 验证 + Commit**

Run: `npm run build`（仅类型，未渲染）。
```bash
git add src/components/CommandPalette/commands.ts
git commit -m "feat(palette): unified command model buildCommands (P3)"
```

---

## Task 3: 重写 CommandPalette.tsx

**Files:** Modify `src/components/CommandPalette/CommandPalette.tsx`

- [ ] **Step 1: 读现有实现**（保留 overlay/card 类名与 close 逻辑）。

- [ ] **Step 2: 重写组件**

```tsx
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { buildCommands, type Command } from './commands';

const GROUP_ORDER: Command['group'][] = ['action','create','session','tab'];
const GROUP_LABEL: Record<Command['group'], string> = { action:'cmd_grp_action', create:'cmd_grp_create', session:'cmd_grp_session', tab:'cmd_grp_tab' };

export const CommandPalette: React.FC = () => {
  const { t } = useTranslation('gwshell');
  const store = useAppStore();
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.save);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const commands = useMemo(() => buildCommands({
    sessions: store.sessions, tabs: store.tabs, keymapOverrides: settings.keymapOverrides ?? {}, t,
    addTab: store.addTab, setActiveTab: store.setActiveTab,
    setShowNewSession: store.setShowNewSession, setShowQuickConnect: store.setShowQuickConnect,
    setShowLocalTerminal: store.setShowLocalTerminal, setShowSettings: store.setShowSettings,
    toggleSidebar: store.toggleSidebar,
    toggleTheme: () => saveSettings({ ...settings, theme: settings.theme === 'dark' ? 'light' : 'dark' }),
  }), [store.sessions, store.tabs, settings, t, saveSettings]);
  // NOTE: confirm each store.* name exists; adjust to real names.

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      c.label.toLowerCase().includes(q) ||
      (c.sub?.toLowerCase().includes(q)) ||
      (c.keywords?.toLowerCase().includes(q)));
  }, [commands, query]);

  useEffect(() => { setIndex(0); }, [query]);

  const close = () => store.setShowCommandPalette(false);
  const runAt = (i: number) => { const c = filtered[i]; if (c) { close(); c.run(); } };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); runAt(index); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector('.command-palette-item.active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  // group filtered preserving GROUP_ORDER; compute flat index per item for active highlight
  let flat = -1;
  return (
    <div className="command-palette-overlay" onMouseDown={close}>
      <div className="command-palette-card" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <input ref={inputRef} className="command-palette-input" placeholder={t('palette_placeholder')}
               value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="command-palette-list" ref={listRef}>
          {filtered.length === 0 && <div className="command-palette-empty">{t('palette_no_results')}</div>}
          {GROUP_ORDER.map((g) => {
            const items = filtered.filter((c) => c.group === g);
            if (items.length === 0) return null;
            return (
              <div key={g} className="command-palette-group">
                <div className="command-palette-group-title">{t(GROUP_LABEL[g])}</div>
                {items.map((c) => {
                  flat += 1; const my = flat; const Icon = c.icon;
                  return (
                    <div key={c.id}
                         className={`command-palette-item${my === index ? ' active' : ''}`}
                         onMouseEnter={() => setIndex(my)} onClick={() => runAt(my)}>
                      {Icon && <Icon size={14} className="command-palette-item-icon" />}
                      <span className="command-palette-item-label">{c.label}</span>
                      {c.sub && <span className="command-palette-item-sub">{c.sub}</span>}
                      {c.hint && <kbd className="command-palette-item-hint">{c.hint}</kbd>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
```
（**严格对齐真实 store 方法名**——逐一在 appStore 确认 `setShowQuickConnect`/`setShowLocalTerminal`/`setShowNewSession`/`setShowSettings`/`toggleSidebar` 存在；不存在的用 NewAssetMenu 实际触发方式替换。theme 取反用 settingsStore.save。）

- [ ] **Step 3: 验证（桩截图）**

Run: `npm run build && npm run smoke:check`。
浏览器桩：打开面板（设 `store.setShowCommandPalette(true)` 或点药丸——T4后）；空查询显示分组；输入过滤；↑↓+Enter；点击执行（如"切换主题"立即变亮/暗）。

- [ ] **Step 4: Commit**
```bash
git add src/components/CommandPalette/CommandPalette.tsx
git commit -m "feat(palette): grouped command palette with actions/create/session/tab (P3)"
```

---

## Task 4: ⌘K 重绑（按平台）

**Files:** Modify `src/keymap/actions.ts`

- [ ] **Step 1: 重绑**

`actions.ts`：`import { IS_MACOS } from '../lib/platform';`，把 `palette.open` 的 `defaultBinding` 改为：
```ts
defaultBinding: IS_MACOS ? 'Meta+K' : 'Ctrl+K',
```
其余不动。

- [ ] **Step 2: 验证 + Commit**

Run: `npm run build`。桩/真机：mac 按 ⌘K 打开（桩环境无法测真实键，构建通过即可，真机由 T7 人工验）。
```bash
git add src/keymap/actions.ts
git commit -m "feat(palette): bind palette.open to Cmd/Ctrl+K by platform (P3)"
```

---

## Task 5: Titlebar ⌘K 药丸 + 样式

**Files:** Modify `src/components/TitleBar/TitleBar.tsx`, `src/styles/global.css`

- [ ] **Step 1: 药丸**

`TitleBar.tsx`：把空的 `.titlebar-center` 改为含按钮（确认 `setShowCommandPalette` 来自 useAppStore；`Search` 图标来自 lucide）：
```tsx
<div className="titlebar-center" data-tauri-drag-region>
  <button type="button" className="titlebar-cmdk" onClick={() => setShowCommandPalette(true)}>
    <Search size={12} />
    <span>{t('palette_entry')}</span>
    <kbd>{IS_MACOS ? '⌘K' : 'Ctrl K'}</kbd>
  </button>
</div>
```

- [ ] **Step 2: 样式（global.css，令牌）**

```css
.titlebar-cmdk{
  -webkit-app-region: no-drag; app-region: no-drag;
  display:flex; align-items:center; gap:6px;
  height:22px; padding:0 10px; min-width:200px; max-width:360px;
  background:var(--bg-tertiary); border:1px solid var(--border-color);
  border-radius:var(--radius-md); color:var(--text-secondary);
  font-size:12px; cursor:pointer; justify-content:center;
}
.titlebar-cmdk:hover{ color:var(--text-primary); border-color:var(--border-light); background:var(--bg-hover); }
.titlebar-cmdk kbd{ margin-left:6px; padding:0 5px; border-radius:var(--radius-sm);
  background:var(--bg-secondary); color:var(--text-muted); font-size:10.5px; }
```

- [ ] **Step 3: palette 增强样式（global.css）**

为新结构补：`.command-palette-group-title`（小写标签、`--text-muted`、`--space` 内距）、`.command-palette-item-icon`（`--text-secondary`）、`.command-palette-item-hint`（kbd chip：`--bg-secondary`/`--text-muted`/`--radius-sm`）、`.command-palette-item` flex 对齐（icon | label | sub(右对齐 muted) | hint）。全用令牌。

- [ ] **Step 4: 验证（桩截图）+ Commit**

Run: `npm run build && npm run smoke:check`。桩截图：titlebar 中央出现 ⌘K 药丸；点击打开面板；面板分组/图标/hint 样式正确。
```bash
git add src/components/TitleBar/TitleBar.tsx src/styles/global.css
git commit -m "feat(nav): titlebar Cmd-K command entry pill + palette styles (P3)"
```

---

## Task 6: i18n 文案

**Files:** Modify `src/i18n/locales/gwshell.{en,zh}.json`

- [ ] **Step 1: 加键（两文件，en/zh 对齐）**

- `palette_entry` — en "Search or run a command", zh "搜索或输入命令"
- `cmd_grp_action` — "Commands"/"命令"
- `cmd_grp_create` — "Create"/"创建"
- `cmd_grp_session` — "Sessions"/"会话"
- `cmd_grp_tab` — "Tabs"/"标签"
- `cmd_new_ssh` — "New SSH"/"新建 SSH"
- `cmd_new_local` — "New local terminal"/"新建本地终端"
- `cmd_quick_connect` — "Quick connect"/"快速连接"
- `cmd_open_home` — "Open home"/"打开主页"
- `cmd_toggle_theme` — "Toggle theme"/"切换主题"
- `cmd_toggle_sidebar` — "Toggle sidebar"/"切换侧栏"

（`palette_placeholder`/`palette_no_results` 已存在；keymap 动作的 `action_*` 标签已存在。）确认 buildCommands/组件里用到的每个 key 都已加。

- [ ] **Step 2: 验证 + Commit**

Run: `npm run build`。
```bash
git add src/i18n/locales/gwshell.en.json src/i18n/locales/gwshell.zh.json
git commit -m "i18n(palette): command groups, create commands, entry pill (P3)"
```

---

## Task 7: 终验

- [ ] **Step 1:** `npm run build && npm run smoke:check` 全过。
- [ ] **Step 2: 人工（真应用 `npm run tauri dev`）**
  - [ ] ⌘K（mac）/ Ctrl+K（其他）打开面板；titlebar 药丸点击亦可
  - [ ] 空查询显示分组：命令 / 创建 / 会话 / 标签
  - [ ] 输入过滤；↑↓ 选择、Enter 执行、Esc 关闭、hover/点击
  - [ ] 执行动作生效：切换主题、打开设置、新建 SSH、连接会话、切标签、切侧栏
  - [ ] 配色/圆角/玻璃跟随 P1；中英文案正确
- [ ] **Step 3:** 按 `superpowers:finishing-a-development-branch` 收尾。

---

## 自查（spec 覆盖）

- §3 命令模型 → T2 ✓
- §4 面板重写 → T3 ✓
- §5 ⌘K 绑定 → T1(platform)+T4 ✓
- §6 药丸 → T5 ✓
- §7 样式 → T5 ✓
- i18n → T6 ✓
- §9 验证 → T7 ✓
