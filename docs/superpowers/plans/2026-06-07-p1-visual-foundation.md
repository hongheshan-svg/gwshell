# P1 视觉地基 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过设计令牌、字体分工、圆角/间距与纯 CSS 轻半透明，把 GWShell 从 Dracula 等宽风刷新为「中性灰阶 + 靛蓝」现代风，不改布局与交互。

**Architecture:** 改动集中在 CSS 令牌层（`global.css` 的 `:root` / `[data-theme=light]`）+ 两处基础字体声明 + 一段 `uiFont→--font-sans` 注入。组件 CSS 大多已走令牌，改令牌即级联生效；少量硬编码色/圆角与 tsx 内联色分批清理。

**Tech Stack:** Tauri 2 + React + TypeScript + Vite + Zustand；xterm.js（终端正文字体走 `terminalFont`，与本次无关）。

**测试现实:** 本仓库无自动化测试。每个 task 的验收 = `npm run build`（tsc+vite）+ `npm run smoke:check` + 指定 `grep` 断言 + `npm run tauri dev` 人工核对。

**参考 spec:** `docs/superpowers/specs/2026-06-07-p1-visual-foundation-design.md`

---

## 文件结构（改动面）

| 文件 | 职责 / 改动 |
|---|---|
| `src/styles/global.css` | 替换两个令牌块；body 字体；半透明表面；选中/悬停态；圆角令牌化 |
| `src/App.css` | 基础字体改 sans；少量硬编码色/圆角令牌化 |
| `src/hooks/useSettingsEffects.ts` | 新增 `uiFont → --font-sans` 注入 effect |
| `src/stores/settingsStore.ts` | `uiFont` 默认改 sans（:90） |
| `src/components/Settings/SettingsModal.tsx` | `uiFont` 默认改 sans（:124）；`fonts` 列表加 sans 选项（:516） |
| `src/components/ServerPanel/ServerPanel.css` | 跟随新令牌校准 |
| `*.tsx` | 内联 hex 残留清理（分批，grep 校验） |

---

## Task 1: 替换暗/亮设计令牌

**Files:**
- Modify: `src/styles/global.css:1-77`（`:root` 与 `[data-theme='light']` 两个块）

- [ ] **Step 1: 先确认当前令牌块范围**

Run: `grep -n "^:root\|data-theme='light'\|^}" src/styles/global.css | head`
Expected: `:root` 在第 1 行附近，`[data-theme='light']` 在第 46 行附近。

- [ ] **Step 2: 替换 `:root` 块**

把 `global.css` 顶部 `:root { … }` 整块替换为（**注意保留 `--sidebar-*` / `--tabbar-height` / `--statusbar-height` 布局变量**）：

```css
:root {
  /* Neutral slate dark + indigo signature */
  --bg-primary:   #0d0e12;
  --bg-secondary: #16171d;
  --bg-tertiary:  #1c1d25;
  --bg-hover:     #22232c;
  --bg-active:    #2a2b36;
  --bg-card:      #14151a;

  --border-color: #24262e;
  --border-light: #2e3039;

  --text-primary:   #e7e9f0;
  --text-secondary: #9ca3b4;
  --text-muted:     #5b6172;

  --accent-primary: #6366f1;
  --accent-primary-rgb: 99, 102, 241;
  --accent-hover:   #818cf8;
  --accent-bg:      rgba(99, 102, 241, 0.14);

  --success: #4ade80;  --success-rgb: 74, 222, 128;
  --warning: #fbbf24;  --warning-rgb: 251, 191, 36;
  --danger:  #f87171;  --danger-rgb: 248, 113, 113;

  /* Layout (preserved) */
  --sidebar-width: 220px;
  --sidebar-collapsed-width: 44px;
  --tabbar-height: 32px;
  --statusbar-height: 24px;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;

  --font-mono: 'Cascadia Mono', 'JetBrains Mono', 'Consolas', 'Fira Code', monospace;
  --font-sans: -apple-system, system-ui, 'Segoe UI', 'Inter', Roboto, 'Helvetica Neue', Arial, sans-serif;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.25);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.35);
  --shadow-lg: 0 12px 40px -8px rgba(0, 0, 0, 0.55);

  --surface-blur: 7px;
  --chrome-bg: rgba(22, 23, 29, 0.78);
  --term-bg:   rgba(6, 7, 10, 0.92);
}
```

- [ ] **Step 3: 替换 `[data-theme='light']` 块**

```css
[data-theme='light'] {
  --bg-primary:   #f7f8fa;
  --bg-secondary: #eef0f4;
  --bg-tertiary:  #e4e7ec;
  --bg-hover:     #e0e3e9;
  --bg-active:    #d6dae2;
  --bg-card:      #ffffff;

  --border-color: #d8dce3;
  --border-light: #e6e9ee;

  --text-primary:   #1a1c23;
  --text-secondary: #5b6172;
  --text-muted:     #8a91a0;

  --accent-primary: #4f46e5;
  --accent-primary-rgb: 79, 70, 229;
  --accent-hover:   #4338ca;
  --accent-bg:      rgba(79, 70, 229, 0.10);

  --success: #16a34a;  --success-rgb: 22, 163, 74;
  --warning: #ca8a04;  --warning-rgb: 202, 138, 4;
  --danger:  #dc2626;  --danger-rgb: 220, 38, 38;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.10);
  --shadow-lg: 0 12px 40px -8px rgba(0, 0, 0, 0.16);

  --chrome-bg: rgba(247, 248, 250, 0.80);
  --term-bg:   rgba(255, 255, 255, 0.96);
}
```

- [ ] **Step 4: 构建 + 烟雾检查**

Run: `npm run build && npm run smoke:check`
Expected: 均通过，无 TS / 构建错误。

- [ ] **Step 5: 人工核对**

Run: `npm run tauri dev`，确认整体由 Dracula 蓝黑变为中性灰、强调色变靛蓝；切换亮/暗主题都正常。

- [ ] **Step 6: Commit**

```bash
git add src/styles/global.css
git commit -m "feat(ui): neutral slate + indigo design tokens (P1)"
```

---

## Task 2: 字体分工（chrome→sans，终端→mono 不变）

**Files:**
- Modify: `src/styles/global.css:88`（`html, body, #root` 的 `font-family`）
- Modify: `src/App.css:9`

- [ ] **Step 1: 断言现状**

Run: `grep -n "font-family: var(--font-mono)" src/styles/global.css | head -1`
Expected: 第 88 行命中（body 当前用 mono）。

- [ ] **Step 2: 改 `global.css:88`**

把 `html, body, #root` 规则里的：
```css
  font-family: var(--font-mono);
```
改为：
```css
  font-family: var(--font-sans);
```

- [ ] **Step 3: 改 `App.css:9`**

把：
```css
  font-family: 'Cascadia Mono', 'JetBrains Mono', 'Consolas', 'Fira Code', monospace;
```
改为：
```css
  font-family: var(--font-sans);
```

- [ ] **Step 4: 核对 mono 保留点未被波及**

Run: `grep -nE "font-family: (var\(--font-mono\)|'?(JetBrains|Cascadia|Fira)|monospace)" src/styles/global.css`
Expected: 终端/代码/snippet 相关规则（约 1130、1267、1406、1459、1469、3154、3183、3202、3291、3317、3491、3528 等）仍显式声明 mono——这些**保持不变**，无需改。确认它们指向的是终端/命令/代码类元素，不是普通 UI 文本。

- [ ] **Step 5: 构建 + 人工核对**

Run: `npm run build && npm run smoke:check`，然后 `npm run tauri dev`：标题栏/侧栏/标签/状态栏/菜单为 sans；终端正文、命令、SFTP 编辑器仍为等宽。

- [ ] **Step 6: Commit**

```bash
git add src/styles/global.css src/App.css
git commit -m "feat(ui): split fonts — sans chrome, mono terminal (P1)"
```

---

## Task 3: 接活 `uiFont` → `--font-sans`

**Files:**
- Modify: `src/hooks/useSettingsEffects.ts`（新增一个 effect）
- Modify: `src/stores/settingsStore.ts:90`
- Modify: `src/components/Settings/SettingsModal.tsx:124` 与 `:516`

- [ ] **Step 1: 在 `useSettingsEffects.ts` 新增注入 effect**

在 `setLocale` 的 effect（约 :43-45）之后，新增：

```ts
  // UI (chrome) font — drives the CSS --font-sans token. Empty falls back to
  // the stylesheet default. Terminal font is separate (terminalFont).
  useEffect(() => {
    const sans = settings.uiFont?.trim();
    if (sans) {
      document.documentElement.style.setProperty('--font-sans', sans);
    } else {
      document.documentElement.style.removeProperty('--font-sans');
    }
  }, [settings.uiFont]);
```

- [ ] **Step 2: 改 `settingsStore.ts:90` 默认值**

把：
```ts
  uiFont: 'JetBrainsMono, NotoSansSC',
```
改为：
```ts
  uiFont: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans SC", sans-serif',
```

- [ ] **Step 3: 改 `SettingsModal.tsx:124` 默认值（[[dual-appsettings-sync]] 同步）**

把第 124 行 `uiFont: 'JetBrainsMono, NotoSansSC',` 改为与 Step 2 完全相同的 sans 默认值。

- [ ] **Step 4: 给 `fonts` 下拉（`SettingsModal.tsx:516`）加 sans 选项**

把：
```ts
  const fonts = [CMD_TERMINAL_FONT, 'Consolas', 'Cascadia Mono', 'Cascadia Code', 'JetBrains Mono, "Noto Sans SC", monospace', 'Fira Code', 'monospace'];
```
改为（前置两个 sans 选项，使 UI 字体下拉里可选）：
```ts
  const fonts = ['system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans SC", sans-serif', 'Inter, system-ui, sans-serif', CMD_TERMINAL_FONT, 'Consolas', 'Cascadia Mono', 'Cascadia Code', 'JetBrains Mono, "Noto Sans SC", monospace', 'Fira Code', 'monospace'];
```

- [ ] **Step 5: 校验两处默认一致**

Run: `grep -rn "uiFont:" src/stores/settingsStore.ts src/components/Settings/SettingsModal.tsx`
Expected: 两处值**完全一致**（均为 Step 2 的 sans 字符串）。

- [ ] **Step 6: 构建 + 人工核对**

Run: `npm run build && npm run smoke:check`，然后 `npm run tauri dev`：设置 → UI 字体下拉含 sans 选项；切换后界面字体实时变化（验证 effect 生效）；恢复默认仍为 sans。

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useSettingsEffects.ts src/stores/settingsStore.ts src/components/Settings/SettingsModal.tsx
git commit -m "feat(settings): wire uiFont to --font-sans with sans default (P1)"
```

---

## Task 4: 轻半透明表面（B 档，纯 CSS）

**Files:**
- Modify: `src/styles/global.css`（chrome 表面规则 + 终端容器规则）

- [ ] **Step 1: 定位 chrome 表面规则**

Run: `grep -nE "^\.(titlebar|tabbar|statusbar|sidebar)[ ,{]|background: var\(--bg-secondary\)" src/styles/global.css`
Expected: 得到 `.titlebar`、标签栏、状态栏、侧栏等表面规则行号。

- [ ] **Step 2: 为每个 chrome 表面规则加半透明 + 模糊**

对 `.titlebar`、侧栏容器、`.tabbar`、状态栏这几条规则，将其 `background: var(--bg-secondary);`（或对应实色）改为：

```css
  background: var(--chrome-bg);
  backdrop-filter: blur(var(--surface-blur));
  -webkit-backdrop-filter: blur(var(--surface-blur));
```

> 只改这几个外层 chrome 容器，不要给每个子元素都加 blur（性能）。

- [ ] **Step 3: 确认终端区保持较实**

Run: `grep -nE "xterm|\.terminal|terminal-container|\.term" src/styles/global.css | head`
找到终端容器规则，确保其背景为 `var(--term-bg)`（~92% 实）或终端主题色，**不加 backdrop-filter**。若当前是透明/继承，显式设 `background: var(--term-bg);`。

- [ ] **Step 4: 构建 + 人工核对**

Run: `npm run build && npm run smoke:check`，然后 `npm run tauri dev`：chrome 表面有轻微层次/通透感，终端文字清晰不糊；暗/亮主题都成立。

- [ ] **Step 5: Commit**

```bash
git add src/styles/global.css
git commit -m "feat(ui): subtle CSS translucency on chrome surfaces (P1)"
```

---

## Task 5: 选中/悬停态改柔光

**Files:**
- Modify: `src/styles/global.css`（会话项、标签、输入/按钮 focus）

- [ ] **Step 1: 定位选中态规则**

Run: `grep -nE "\.active|\.selected|:hover|box-shadow: inset|--accent-bg" src/styles/global.css | grep -iE "host|session|tab|item|nav" | head -30`

- [ ] **Step 2: 会话项选中态**

将侧栏会话/资产项的选中规则改为柔光：
```css
  background: var(--accent-bg);
  color: var(--text-primary);
  border-radius: var(--radius-md);
  box-shadow: inset 2px 0 0 var(--accent-primary);
```
（保留一条 2px inset 强调条作为左侧标识，其余用柔色背景。）

- [ ] **Step 3: 标签选中态**

将激活标签由整块换色改为下划线 + 轻提亮：
```css
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
  box-shadow: inset 0 -2px 0 var(--accent-primary);
```

- [ ] **Step 4: 输入/按钮 focus 柔光环**

为主要 `input:focus` / `select:focus` / 主按钮 `:focus-visible` 规则加：
```css
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-bg);
  border-color: var(--accent-primary);
```

- [ ] **Step 5: 构建 + 人工核对 + Commit**

Run: `npm run build && npm run smoke:check`，`npm run tauri dev` 核对选中/悬停/聚焦均为柔光态、无硬色块。
```bash
git add src/styles/global.css
git commit -m "feat(ui): soft accent for selected/hover/focus states (P1)"
```

---

## Task 6: 圆角令牌化

**Files:**
- Modify: `src/styles/global.css`、`src/App.css`

- [ ] **Step 1: 列出硬编码圆角**

Run: `grep -rnE "border-radius: ?[0-9]" src/styles/global.css src/App.css | grep -v "var(--radius"`
Expected: ~52 行。

- [ ] **Step 2: 按映射表批量替换**

| 原值 | 替换为 |
|---|---|
| `border-radius: 1px` / `2px` / `3px` / `4px` | `var(--radius-sm)`（6px） |
| `border-radius: 6px` / `8px` | `var(--radius-md)`（8px） |
| `border-radius: 10px`+ | `var(--radius-lg)`（12px） |
| `border-radius: 50%` / `9999px`（圆形/胶囊） | **保持不变** |

逐条替换 Step 1 列出的行（圆形/胶囊例外）。

- [ ] **Step 3: 校验**

Run: `grep -rnE "border-radius: ?[0-9]" src/styles/global.css src/App.css | grep -vE "var\(--radius|50%|9999px"`
Expected: 空（除有意保留的圆形/胶囊外，无裸数值圆角）。

- [ ] **Step 4: 构建 + Commit**

Run: `npm run build && npm run smoke:check`
```bash
git add src/styles/global.css src/App.css
git commit -m "refactor(ui): tokenize border-radius to --radius-* (P1)"
```

---

## Task 7: ServerPanel.css 校准

**Files:**
- Modify: `src/components/ServerPanel/ServerPanel.css`

- [ ] **Step 1: 审查硬编码值**

Run: `grep -nE "#[0-9a-fA-F]{3,6}|border-radius: ?[0-9]" src/components/ServerPanel/ServerPanel.css`

- [ ] **Step 2: 替换为令牌**

将硬编码背景/边框/文本色改为 `var(--bg-card)` / `var(--border-color)` / `var(--text-*)`；卡片圆角改 `var(--radius-lg)`；强调色改 `var(--accent-primary)`。语义色（cpu/mem/net 状态）改 `var(--success|warning|danger)`。

- [ ] **Step 3: 构建 + 人工核对 + Commit**

Run: `npm run build && npm run smoke:check`，`npm run tauri dev` 打开 ServerPanel 核对配色与新令牌一致。
```bash
git add src/components/ServerPanel/ServerPanel.css
git commit -m "refactor(ui): ServerPanel calibrate to new tokens (P1)"
```

---

## Task 8: tsx 内联 hex 残留清理（分批）

**Files:**
- Modify: 多个 `*.tsx`（grep 驱动）

- [ ] **Step 1: 列出 Dracula/Catppuccin 残留**

Run: `grep -rniE "#(50fa7b|5ac8fa|ff5555|f1fa8c|cdd6f4|a6adc8|f38ba8|bd93f9|ff79c6)" src --include="*.tsx" --include="*.css"`
Expected: 一批内联 hex 与 `var(--x, #fallback)` 形式的旧 fallback。

- [ ] **Step 2: 逐处替换**

- `var(--text-primary, #cdd6f4)` → `var(--text-primary)`（去掉过时 fallback，或换成新令牌值）
- `var(--danger, #f38ba8)` → `var(--danger)`
- 裸内联 hex（如 `color: '#5ac8fa'`）→ 对应 `var(--accent-primary)` 等令牌（在 tsx 内联 style 中用 `'var(--accent-primary)'`）。

- [ ] **Step 3: 校验无旧色残留**

Run: `grep -rniE "#(50fa7b|5ac8fa|ff5555|f1fa8c|cdd6f4|a6adc8|f38ba8)" src --include="*.tsx" --include="*.css"`
Expected: 空（或仅剩明确有意保留项）。

- [ ] **Step 4: 构建 + Commit**

Run: `npm run build && npm run smoke:check`
```bash
git add -A src
git commit -m "refactor(ui): replace residual hardcoded colors with tokens (P1)"
```

---

## Task 9: 终验

- [ ] **Step 1: 全量构建 + 烟雾**

Run: `npm run build && npm run smoke:check`
Expected: 均通过。

- [ ] **Step 2: 旧色清零断言**

Run: `grep -rniE "#(50fa7b|5ac8fa|ff5555|f1fa8c)" src`
Expected: 空。

- [ ] **Step 3: 人工验收清单（`npm run tauri dev`）**

- [ ] chrome 为 sans、终端正文为 mono
- [ ] 暗/亮主题均为「中性灰阶 + 靛蓝」，无 Dracula 霓虹残留
- [ ] chrome 表面有轻微通透层次，终端文字清晰
- [ ] 选中/悬停/聚焦为柔光态，圆角明显变大
- [ ] 设置里可切换 UI 字体并实时生效
- [ ] ServerPanel 配色与新令牌一致

- [ ] **Step 4: 合并/收尾**

按 `superpowers:finishing-a-development-branch` 处理（合并到 main 或开 PR）。

---

## 自查（spec 覆盖）

- §3 令牌 → Task 1 ✓
- §4 字体分工 → Task 2 ✓
- §4.1 uiFont 方案 A → Task 3 ✓
- §5 半透明 B → Task 4 ✓
- §6 选中/悬停态 → Task 5 ✓
- §7 圆角令牌化 / ServerPanel / tsx 清理 → Task 6/7/8 ✓
- §9 验证 → Task 9 ✓
