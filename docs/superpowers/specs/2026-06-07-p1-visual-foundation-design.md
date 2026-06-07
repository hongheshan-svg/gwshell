# P1 · 视觉地基（Visual Foundation）设计

**日期:** 2026-06-07
**状态:** 已确认（uiFont 采用方案 A）
**所属:** GWShell UI 现代化改造，子项目 1 / 4（P1→P2→P3→P4）

---

## 1. 背景与目标

GWShell 当前 UI 精准复刻了 2018 年一代开发者工具的语言，因此"对"但不"新"。根因（均来自 `src/styles/global.css`）：

1. 整个界面被锁成等宽字体（`--font-sans: var(--font-mono)`）——最强的"老终端"信号。
2. 调色板是原封不动的 Dracula（`#50fa7b / #f1fa8c / #ff5555` + 青色强调）。
3. 极锐角（`--radius: 1~2px`）+ 高密度 + 几乎无阴影，缺呼吸感与层次。

**P1 目标：** 在不改变布局结构、不改交互的前提下，仅通过**设计令牌 + 字体分工 + 圆角/间距 + 轻量半透明**完成一次"脱胎换骨"的视觉刷新。这是 P2/P3/P4 的视觉地基。

**非目标（明确排除）：**
- 布局/导航结构改动 → P3
- 主页仪表盘 → P2
- 终端 Block 化 → P4
- 真·OS 级毛玻璃（原生窗口 vibrancy）→ 作为未来可选增强，本期不做

---

## 2. 已锁定的设计决策

经可视化对比，用户已确认：

| 决策 | 结论 |
|---|---|
| 整体方向 | 中性灰阶背景 + 单一签名色（方案「①+③ 混合」） |
| 签名色 | **靛蓝 `#6366f1`**（hover `#818cf8`，亮色态 `#4f46e5`） |
| 字体 | **分工**：chrome 用 sans，终端正文保留 mono |
| 圆角/间距 | 圆角 1-2px → 6/8/12px，间距整体放大 |
| 半透明 | **B 档：CSS 轻半透明（窗体 ~78% + 轻模糊），不碰原生窗口**，跨平台一致；终端区保持较实以保可读 |

---

## 3. 设计令牌（替换 `:root` 与 `[data-theme='light']`）

### 3.1 暗色（默认）

```css
:root {
  /* 中性灰阶背景（去蓝调 Dracula） */
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

  /* 签名色：靛蓝 */
  --accent-primary: #6366f1;
  --accent-primary-rgb: 99, 102, 241;
  --accent-hover:   #818cf8;
  --accent-bg:      rgba(99, 102, 241, 0.14);

  /* 语义色降霓虹 */
  --success: #4ade80;  --success-rgb: 74, 222, 128;
  --warning: #fbbf24;  --warning-rgb: 251, 191, 36;
  --danger:  #f87171;  --danger-rgb: 248, 113, 113;

  /* 圆角放大 */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* 字体分工：解绑 mono */
  --font-mono: 'Cascadia Mono', 'JetBrains Mono', 'Consolas', 'Fira Code', monospace;
  --font-sans: -apple-system, system-ui, 'Segoe UI', 'Inter', Roboto, 'Helvetica Neue', Arial, sans-serif;

  --shadow-sm: 0 1px 2px rgba(0,0,0,0.25);
  --shadow-md: 0 4px 16px rgba(0,0,0,0.35);
  --shadow-lg: 0 12px 40px -8px rgba(0,0,0,0.55);

  /* 半透明地基（B 档）——见 §5 */
  --surface-blur: 7px;
  --chrome-bg: rgba(22, 23, 29, 0.78);   /* 标题栏/侧栏/标签栏等 chrome 表面 */
  --term-bg:   rgba(6, 7, 10, 0.92);      /* 终端区：保持较实 */
}
```

### 3.2 亮色（同步重做为 中性 + 靛蓝）

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

  --success: #16a34a;  --warning: #ca8a04;  --danger: #dc2626;

  --shadow-sm: 0 1px 2px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 16px rgba(0,0,0,0.10);
  --shadow-lg: 0 12px 40px -8px rgba(0,0,0,0.16);

  --chrome-bg: rgba(247, 248, 250, 0.80);
  --term-bg:   rgba(255, 255, 255, 0.96);
}
```

---

## 4. 字体分工策略

**原则：chrome = sans，终端内容 = mono。**

- `html, body`（`global.css:88`）与 `App.css:9` 的基础 `font-family` 从 `var(--font-mono)` 改为 `var(--font-sans)`。
- **保留 mono** 的位置（已用 `var(--font-mono)` 或显式 monospace 的约 13 处）需逐一判定：
  - 真·代码/终端/命令展示（snippet cmd、SFTP 编辑器、命令面板里的命令） → **保留 mono**。
  - 纯 UI 标签被动继承了 mono 的 → 随 body 改为 sans。
- **xterm 终端正文** 由 xterm 自身的 `fontFamily` 选项渲染（`TerminalView.tsx:427` 读 `settings.terminalFont`，默认 `'JetBrainsMono, NotoSansSC'`），**不受 CSS body 字体影响**——已核实，本次改动零风险触及终端可读性。

### 4.1 关于 `uiFont` 孤儿设置（已核实）

`settingsStore.ts:90` 定义了 `uiFont`（默认 `'JetBrainsMono, NotoSansSC'`）、`SettingsModal.tsx:552` 提供了选择 UI，但**全工程没有任何地方把它应用到 DOM**（`useSettingsEffects.ts` 只应用 zoom/动画/条纹背景）。即当前界面字体纯由 CSS `var(--font-mono)` 驱动，`uiFont` 是**死设置**。

**已定方案 A（接活 `uiFont`）：**
- 在 `useSettingsEffects.ts` 里 `documentElement.style.setProperty('--font-sans', settings.uiFont?.trim() || <sans 默认>)`，让 `uiFont` 真正驱动 chrome 字体。
- 两处默认值（`settingsStore.ts:90`、`SettingsModal.tsx:124`）从 `'JetBrainsMono, NotoSansSC'` 改为 sans 默认（如 `'-apple-system, system-ui, Segoe UI, Inter, sans-serif'` 或一个简称 + CSS 兜底）。
- 字体下拉 `fonts` 选项需包含可读的 sans 选项；i18n（`settings_ui_font` 已存在，无新增键，确认即可）。
- CSS `--font-sans` token 仍保留作为兜底默认值（settings 为空时生效）。

> ⚠️ 遵守本仓库 [[dual-appsettings-sync]] 约束：默认值两处都要改，避免不一致。

---

## 5. 半透明实现（B 档，纯 CSS）

不改任何 Rust/原生窗口代码。仅在 CSS 层做表面分层：

- **chrome 表面**（`.titlebar` / sidebar / `.tabbar` / statusbar / 卡片）：背景用 `var(--chrome-bg)` + `backdrop-filter: blur(var(--surface-blur))`。
- **终端区**：背景用 `var(--term-bg)`（~92% 实），**不做强模糊**，保证文字清晰。
- 退化：`backdrop-filter` 不支持时浏览器忽略，表面回退为半透明实色，不影响可用性。
- 现状已知：macOS 窗口当前 **未开 transparent**（`lib.rs:1090-1093`，Overlay+transparent 有合成伪影）。**B 档不依赖窗口透明**——它是在不透明窗口内部做 UI 表面分层的"伪深度"，因此与现有窗口设置兼容。若未来 P-future 想要真 vibrancy（C 档），再单独评估开 transparent 的代价。

> 注：因窗口本身不透明，B 档的"半透明"是相对于**应用内底层背景**（`--bg-primary`）的分层，而非透出桌面壁纸。这是有意为之的稳健折中。

---

## 6. 选中态 / 悬停态重塑

把"硬色块填充"换成"柔光 + 细条/微光"：

- 侧栏会话选中：`background: var(--accent-bg)` + 圆角 `--radius-md` + 状态点柔光，替代原 `box-shadow: inset 2px 0 0 accent` 的硬条（可保留更细的 inset 强调条）。
- 标签选中：底部 2px `var(--accent-primary)` 下划线 + 轻微提亮背景，替代整块换色。
- 输入/按钮 focus：`box-shadow: 0 0 0 2px var(--accent-bg)` 柔光环。

---

## 7. 影响文件与工作分解

| 文件 | 改动 | 量 |
|---|---|---|
| `src/styles/global.css` | 替换两个 token 块；body 字体改 sans；逐处审定 mono 保留点；半透明表面分层；选中/悬停态；圆角 token 化 | 主要 |
| `src/App.css` | `:9` 基础字体改 sans；少量硬编码色/圆角 token 化 | 小 |
| `src/components/ServerPanel/ServerPanel.css` | 跟随新 token 校准（卡片圆角/边框/色） | 小 |
| `*.tsx` 内联样式 | ~53 处内联 hex / ~硬编码圆角：将 Dracula/Catppuccin 残留 fallback 与硬色改为 token；非关键 fallback 可分批 | 中（可分批，非阻塞） |
| `TerminalView.tsx` | 已核实 xterm `fontFamily` 走 `terminalFont`，无需改动 | 无 |
| `useSettingsEffects.ts` + `settingsStore.ts` + `SettingsModal.tsx` | 接活 `uiFont`→`--font-sans`（方案 A）；两处默认值改 sans；确认字体下拉含 sans 选项 | 小 |

**实现顺序建议：** 先改 token 块与字体分工（立刻见效）→ 半透明表面 → 选中/悬停态 → 圆角 token 化 → tsx 内联色清理（分批）。

---

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| body 改 sans 后，某些原本靠 mono 对齐的 UI（如对齐的数字/表格）错位 | §4 的逐处审定；对真正需要等宽的 UI 显式加 `var(--font-mono)` |
| `backdrop-filter` 在低端机有性能开销 | blur 半径仅 7px、面积有限；终端区不模糊；可后续加"降低透明度"设置 |
| tsx 内联 hex 遗漏导致局部仍是旧色 | 审计已列出，grep 校验 `#50fa7b|#5ac8fa|#ff5555|#f1fa8c`；分批清理不阻塞主体上线 |
| 亮色主题对比度不足 | 文本/边框令牌按 WCAG AA 校准，签名色亮色态用更深的 `#4f46e5` |

---

## 9. 验证

无自动化测试。验收方式：

1. `npm run smoke:check` 通过。
2. `npm run build`（tsc + vite）通过。
3. `npm run tauri dev` 人工核对：
   - chrome 为 sans、终端正文为 mono；
   - 暗/亮主题切换均为"中性灰阶 + 靛蓝"，无残留 Dracula 霓虹；
   - 选中/悬停为柔光态、圆角变大、表面有轻微层次；
   - 终端文字清晰可读（未被模糊影响）。
4. `grep -rniE "#(50fa7b|5ac8fa|ff5555|f1fa8c)" src` 仅剩有意保留项（理想为 0）。

---

## 10. 后续（不在 P1 范围）

- **P2** ServerPanel 升级为"主页"仪表盘（最大差异化）。
- **P3** CommandPalette 升为 ⌘K 主导航，侧栏降级。
- **P4** 终端 Block 化（基于 OSC 133，分两阶段）。
- **P-future（可选）** C 档真·OS vibrancy：评估开窗口 transparent 的合成伪影代价，分平台（macOS/Windows，Linux 退化）。
