# P4 Phase B · 终端 Block 卡片化（Block Cards）设计

**日期:** 2026-06-07
**状态:** 已确认（在 Phase A 之上叠加；门控沿用 `cmdHintShellIntegration`，无新设置）
**所属:** GWShell UI 现代化，子项目 4 / 4 · Phase B（依赖 P1 令牌 + P4 Phase A 的 OSC 133 + `CommandBlock` 模型）
**分支:** `worktree-p4-phaseb-block-cards`

---

## 1. 背景与现状（Phase A 已具备）

Phase A 已在真机（SSH bash/zsh）跑通，提供了 Phase B 的全部数据基础：

- **OSC 133 注入 + 解析**：本地 bash/zsh/fish 注入集成脚本可靠发射 `A`(prompt)/`B`(cmd-start)/`C`(pre-exec)/`D;<exit>`(done+退出码)；远端 SSH best-effort。门控开关 `cmdHintShellIntegration`（默认关）。
- **`CommandBlock` 模型**（`src/components/Terminal/blocks.ts`）：per-tab `CommandBlock[]`，每个 block 记 `promptMarker`(A/B)、`outputMarker`(C)、`command`、`exitCode`、`state`、`startedAt`、`deco`。`readOutput()` 已能读出 block 的输出文本区间。`MAX_BLOCKS=200` 回收，marker 失效有兜底。
- **轻量表现（Phase A）**：每个执行中的 block 在左侧 gutter 画一条 3px 状态条 decoration（运行=靛蓝 / exit0=绿 / exit≠0=红）；点击弹 DOM 小菜单（复制命令/复制输出/重跑）。
- **导航**：`blockNav.ts` 的 `scrollToAdjacentBlock(±1)`，键位 `block.prev`/`block.next` = ⌘⇧↑/⌘⇧↓（**遗留未确认项**，可能被 webview 拦截）。
- **xterm v6**：支持 `registerMarker()` + `registerDecoration()`（已用），decoration 支持多行 `height`(cells)、`layer:'bottom'`、`overviewRulerOptions`、子元素 `onRender(el)`（`allowProposedApi:true` 已开）。

**Phase B = 在同一套 OSC 133 / `CommandBlock` 数据上，把"3px 状态条 + 点击菜单"升级为完整卡片表现。** 不改注入、不改解析、不新增设置。

---

## 2. 已锁定方向（来自 brainstorm 决策）

| 决策点 | 选定 |
|---|---|
| **卡片力度** | **A · 完整框卡（Warp 风）**：每个 block 框成圆角面板，命令为带底色的头条，退出码角标，状态左边线 |
| **"可折叠"取舍** | **B · Block 聚焦面板**：xterm 固定高度缓冲区**无法真折叠/隐藏输出行**（需 Warp 式自研渲染，不做）。改为点卡片 → 该命令完整输出在右侧浮层单独展开 |
| **设置/门控** | **不新增设置**：`cmdHintShellIntegration` 开启时，block 表现即从"3px 条"换成"整卡"。状态色移到卡片左边线 + 头部角标。避免 [[dual-appsettings-sync]] 双写 |
| **可选件** | 全要：① 粘性命令头 ② Overview 刻度尺 ③ 卡片悬停工具条 ④ 修复 block 导航快捷键 |

---

## 3. 渲染架构 — 混合方案（③）

核心难点：在 xterm 上画**可变高度**卡片，且不写自研渲染器。各取所长：

| 元素 | 渲染机制 | 理由 |
|---|---|---|
| **已完成 block 的卡框**（左边线 + 头部带 + 退出码角标 + 悬停工具条） | **xterm decoration**（全宽，`marker=promptMarker`，`height=rowSpan`，`layer:'bottom'`，子 DOM 头部） | 跨度已知、高度稳定，**只创建一次**；滚动定位 / alt-buffer 隐藏 / scrollback 裁剪全由 xterm 负责（Phase A 已验证这条路稳） |
| **唯一"运行中"block 的卡框** | **React overlay 单 div** | decoration 高度创建后不可改；运行中 block 持续长高，用 overlay 每帧重算像素矩形 → 平滑增长、零 decoration churn。命令结束、跨度确定后转交给 decoration |
| **粘性命令头** | **React overlay**（视口顶部固定） | 不随 marker 逐行锚定，按 `onScroll` 算"顶行所属 block" |
| **Overview 刻度尺** | **React overlay**（右边缘细轨） | 自绘比原生 `overviewRulerOptions` 更可控（支持点击跳转到具体 block） |
| **聚焦面板** | **React 组件**（右侧浮层） | 纯 React，复用 `readOutput()` |

**关键不变量**：完成卡（decoration）与运行卡（overlay）**共用同一套 CSS class**（`.gw-card` 系列），外观完全一致；运行→完成的交接采用"先建 decoration、下一 tick 再撤 overlay div"，避免 1 帧跳变。

**为何不用纯 React overlay（②）**：完成 block 数量多，逐行像素同步在快速滚动/缩放时有错位风险；decoration 是 xterm 久经考验的逐行锚定。**为何不用纯 decoration（①）**：运行中 block 可变高度会逼出"每帧 dispose+重建"的闪烁。③ 把"逐行精确对齐"交给 xterm、"富交互 + 可变高度"交给 React。

---

## 4. 详细设计

### A1 · 数据模型扩展（`blocks.ts`）

- `CommandBlock` 增字段：`finishedAt?: number`（`finishBlock` 时记）；派生 `durationMs = finishedAt - startedAt`。
- 新增 `blockRowRange(tabId, term, block): { startLine, endLine }`：`startLine = promptMarker.line`，`endLine = 下一个 block 的 promptMarker.line`（无则 `term.buffer.active.length`，即运行中/末尾 block）。与 `readOutput()` 的区间算法一致，抽成共享 helper。
- `rowSpan(block) = max(1, endLine - startLine)`，供 decoration `height`。
- 新增 `activeBlock(tabId): CommandBlock | undefined`：**末尾那个尚未 finalize 成完成卡 decoration 的 block**——即仍 `running` 的，或已 `done` 但下一个 prompt 还没出现（底边未定）的。覆盖 `D → 下一个 A` 之间的空窗，避免刚结束的命令短暂"无卡"。
- 回收：`MAX_BLOCKS` 与 `clearTab` 同时 dispose 新增的任何 marker；`deco` 字段语义从"3px 条"变为"整卡 decoration"。

### A2 · 完成卡渲染管理（`blockCards.ts`，新）

把卡片的命令式 DOM/decoration 逻辑从 `TerminalView.tsx` 抽出，保持后者精简。导出：

- `syncCards(tabId, term)`：在 OSC 133 `A`/`C`/`D` 与终端 `onResize` 后调用。
  - 为**跨度刚确定**（下一个 prompt 已出现）的已完成 block 创建整卡 decoration：`term.registerDecoration({ marker: block.promptMarker, x: 0, width: term.cols, height: rowSpan(block), layer: 'bottom' })`，存入 `block.deco`。
  - `onRender(el)` 内（仅首次）构建子 DOM 头部并贴 `.gw-card` 状态 class（见 A8）。
  - **resize 重建**：列/行变化导致 reflow、行号与 rowSpan 变动 → dispose 并按新 `rowSpan` 重建所有完成卡 decoration（resize 是低频用户操作，可接受）。
- `disposeTabCards(tabId)`：tab 关闭时清理（与 `clearTab` 协同）。
- 头部子 DOM：命令行所在首行的**底色带** + 右侧**退出码角标**（`✓ 0` / `✕ 101`，色按 exit）+ **悬停工具条**（A6）。命令文本本身仍是终端真实文字（不重复渲染），头部只叠背景带 + 右对齐角标/工具条。

### A3 · 运行中卡框 overlay（`BlockLiveFrame.tsx`，新）

- 每个已连接终端挂一个；订阅该 term 的 `onRender`。
- 取 `activeBlock(tabId)`，算像素矩形：`top = (promptMarker.line - buffer.active.viewportY) * cellH`，`height = (bufferEnd - promptMarker.line) * cellH`，宽度 = 终端内容区宽。渲染 `.gw-card.gw-card-live`（底边开口样式表示"进行中"）+ 头部（命令 + 运行中/刚结束角标 + 工具条）。
- **cellH 获取**：优先 xterm 渲染服务尺寸（`_core._renderService.dimensions.css.cell.height`），兜底 `.xterm-screen` 高度 / `term.rows`。
- **隐藏条件**：无运行中 block、`buffer.active.type === 'alternate'`（vim/htop/less 全屏 app 不画卡）、或运行块已滚出视口。

### A4 · 粘性命令头（`BlockStickyHeader.tsx`，新）

- 视口顶部固定条；按 `onScroll`/`onRender` 求"当前视口顶行落在哪个 block 区间内"（用 `blockRowRange`），显示该 block 的命令 + 状态角标。
- 仅当顶行确实在某 block 输出区间内、且非 alt-buffer 时显示；点击 = 聚焦该 block（A5）。半透明 + 模糊（P1 `--surface-blur` 令牌）。

### A5 · Overview 刻度尺（`BlockOverviewRuler.tsx`，新）

- 终端右边缘细轨（~8px）；每个 block 一个彩色刻度，纵向位置 = `promptMarker.line / buffer.active.length`，色按状态（运行/绿/红）。
- 点击刻度 → `term.scrollToLine(block.promptMarker.line)` 跳转；hover 显示命令 tooltip。
- alt-buffer 时隐藏。

### A6 · 卡片悬停工具条（取代 Phase A 点击菜单）

- 卡片头部 hover 时右侧浮出按钮：**复制命令** / **复制输出** / **重跑** / **⤢ 聚焦**。
- 动作复用 Phase A 实现并迁移到 `blockCards.ts`：复制走 `clipboardWrite`（Tauri 插件，navigator 兜底）；复制输出走 `readOutput`；重跑走 `write_to_pty|ssh|serial`（无换行，便于复核）；聚焦走 A7 打开面板。
- 移除 Phase A 的 `openBlockMenu`/`.gw-block-menu` 点击小菜单。

### A7 · 聚焦面板（`BlockFocusPanel.tsx`，新）

- 右侧滑出浮层（轻遮罩，不阻塞终端继续接收输出）。内容：命令、退出码角标、用时（`durationMs`）、`readOutput()` 全文（等宽、可滚动、可选中）、底部 复制输出 / 重跑。
- 打开：卡片"⤢ 聚焦" / 粘性头点击 / 键位 `block.focus`（聚焦当前 block）。关闭：Esc / 点遮罩 / 关闭按钮。
- 由 appStore 持有 `{ tabId, blockId } | null` 的聚焦态，App 根级挂载面板（与现有 modal 风格一致）。

### A8 · 样式（`global.css`，P1 令牌）

新增 `.gw-card` 系列，完成卡与运行卡共用：

- `.gw-card`：圆角 `--radius-md`、边框 `--border-color`、`layer:'bottom'` 半透明底（`--surface-1`/`--term-bg` 叠加），文字透过显示。
- `.gw-card-hdr`：首行底色带 `--bg-secondary`、底边 `--border-color`。
- `.gw-card.running` 左边线 `--accent-primary`（脉冲）；`.ok` 左边线 `--success`；`.err` 左边线 `--danger`。
- `.gw-card-badge.ok/.err`：退出码药丸角标。`.gw-card-toolbar`（hover 显隐）、`.gw-sticky`、`.gw-ruler`/`.gw-ruler-tick`、`.gw-focus-panel`。
- 移除 `.gw-block-deco`（3px 条）与 `.gw-block-menu`。

### A9 · 导航修复 + 键位

- 排查 `block.prev`/`block.next`（⌘⇧↑/⌘⇧↓）为何不触发（webview/系统拦截 Cmd+方向键的嫌疑）：用 xterm `attachCustomKeyEventHandler` 或在 keymap 层确认事件名/修饰键匹配；必要时换一组不被拦截的键位（如 ⌥↑/⌥↓ 或 ⌘[ / ⌘]）。
- 新增 `block.focus` 动作（聚焦当前 block，打开面板）。
- 导航跳转后高亮目标卡片（短暂 ring）。

---

## 5. 影响文件

| 文件 | 改动 |
|---|---|
| `src/components/Terminal/blocks.ts` | 扩展：`finishedAt`/`durationMs`、`blockRowRange`/`rowSpan`/`runningBlock` helper；回收 endMarker 等 |
| `src/components/Terminal/blockCards.ts` | **新**：完成卡 decoration 管理 + 头部子 DOM + 悬停工具条动作 |
| `src/components/Terminal/BlockLiveFrame.tsx` | **新**：运行中卡 React overlay |
| `src/components/Terminal/BlockStickyHeader.tsx` | **新**：粘性命令头 |
| `src/components/Terminal/BlockOverviewRuler.tsx` | **新**：右侧刻度尺 |
| `src/components/Terminal/BlockFocusPanel.tsx` | **新**：聚焦面板 |
| `src/components/Terminal/TerminalView.tsx` | OSC 133 handler 改调 `syncCards`；挂载 overlay 组件；移除 Phase A 3px 条 + 点击菜单 |
| `src/components/Terminal/blockNav.ts` | 导航修复；跳转高亮 |
| `src/keymap/actions.ts` | `block.focus`；必要时改 `block.prev/next` 键位 |
| `src/stores/appStore.ts` | 聚焦态 `focusedBlock`（含开关 action） |
| `src/App.tsx` | 根级挂载 `BlockFocusPanel` |
| `src/styles/global.css` | `.gw-card` 系列；移除 `.gw-block-deco`/`.gw-block-menu` |
| `src/i18n/locales/gwshell.{en,zh}.json` | 复制命令/复制输出/重跑/聚焦/退出码/用时 文案 |

---

## 6. 性能与风险

| 风险 | 缓解 |
|---|---|
| **运行中 block 几何同步**（最大风险） | 仅 1 个运行卡走 overlay，跟 `onRender` 每帧重算；完成即转 decoration。cellH 优先渲染服务尺寸、兜底 DOM 测量 |
| 完成卡 reflow/resize 后行号变动 | `onResize` 时整体 dispose+按新 `rowSpan` 重建（低频，可接受） |
| 运行→完成交接闪跳 | 先建 decoration、下一 tick 再撤 overlay div；两者共用 class |
| alt-buffer（vim/htop/less）误画卡 | 所有 overlay + decoration 在 `buffer.active.type==='alternate'` 时隐藏 |
| decoration/overlay 数量随历史增长 | 完成卡随 `MAX_BLOCKS` 回收；overlay 只渲染视口内 + 1 运行卡；刻度尺为单一 SVG/DOM 轨 |
| 私有 API（`_core._renderService`）随 xterm 升级失效 | 包一层 try/catch + DOM 测量兜底；集中在一个 helper 便于后续替换 |
| 卡片底色遮挡选区/链接 | `layer:'bottom'` 渲染在选区之下；底色用低不透明度令牌 |
| 与 Phase A 历史/补全/导航冲突 | 仅替换"表现层"（3px 条→卡 + 菜单→工具条）；OSC 133 解析、命令历史、ghost 补全路径不动 |

---

## 7. 验证

1. `npm run build` + `npm run smoke:check` + `cargo build` 通过。
2. 真机（需真 shell，本地 bash/zsh 开启 shell 集成）：
   - 每条命令框成卡：命令头底色带、退出码角标（成功绿 ✓0 / 失败红 ✕N）、状态左边线。
   - 运行中命令显示"进行中"开口卡，输出增长平滑、无闪烁；结束后无缝变成完成卡。
   - 卡片头 hover 出工具条；复制命令/复制输出/重跑可用；"⤢ 聚焦"打开右侧面板显示全文+退出码+用时。
   - 长输出滚动时顶部粘性命令头钉住当前命令；右侧刻度尺逐命令着色、点击跳转。
   - ⌘⇧↑/⌘⇧↓（或改后的键位）跳转上一条/下一条命令并高亮。
   - 进入 vim/htop（alt-buffer）卡片/overlay 全部消失，退出后恢复。
   - 关闭 `cmdHintShellIntegration` → 完全恢复普通终端（无卡、无 overlay）。
3. 浏览器桩仅验证编译与"无 OSC 133 时不画卡"；真卡需真 shell。
4. 回归：命令历史、ghost 补全、Phase A 注入/退出码解析均不变。

---

## 8. 不在 Phase B 范围

- 真·折叠/隐藏输出行（需自研渲染器）。
- pwsh/cmd 本地注入、远端强保证注入（沿用 Phase A 限制）。
- Warp 式自研渲染 / 输出语义解析（错误高亮、可点击文件路径等）。
- 卡片拖拽重排、导出单卡为文件、跨会话持久化卡片。
- 真 OS vibrancy（P-future）。
