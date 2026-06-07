# P4 · 终端 Block 化（Terminal Blocks）设计

**日期:** 2026-06-07
**状态:** 已确认（Phase A；本地 bash/zsh/fish 注入 + 远端 best-effort；`cmdHintShellIntegration` 默认关）
**所属:** GWShell UI 现代化，子项目 4 / 4（依赖 P1 令牌；同分支）

---

## 1. 背景与现状（关键）

终端命令边界的"最难部分"其实已部分具备：

- **OSC 133 已在解析**：`TerminalView.tsx:943` 有 `registerOscHandler(133)` 处理 A/B/C（prompt/命令/执行），并按 tab 记 `tabHasOsc133`——但**仅用于命令历史/补全**，**不记录命令的行区间，也忽略 'D'（退出码）**。OSC 7（cwd）也已处理。
- **xterm v6.0.0**：支持 **markers + decorations** API（当前完全未用）。
- **`cmdHintShellIntegration` 是死设置**：定义了、设置面板有开关，但**全工程无任何消费**——即"注入 shell 集成"实际没接线。所以 OSC 133 目前只在**用户 shell 自带集成**时才出现。
- 注入通道现成：本地 shell 由 `pty.rs::resolve_shell` 启动；`init_command` 由前端在连接后写入——可复用为集成脚本注入点。

**结论**：P4 = ①真正实现 shell 集成注入（让 shell 可靠发射带退出码的 OSC 133）+ ②用 markers/decorations 把命令边界做成 block。Warp 式自研渲染不做。

---

## 2. 已锁定方向（分两阶段）

| | 内容 | 本期 |
|---|---|---|
| **Phase A** | 注入 + 命令边界数据模型 + **轻量 block 表现**（左侧状态条 + 命令导航 + 复制命令/输出 + 重跑） | ✅ 本 spec 实现 |
| **Phase B** | 完整 **block 卡片**（命令+输出框成卡、退出码角标、可折叠、粘性命令头） | ⏳ 后续 spec |

Phase A 在"OSC 133 存在时"即生效，且对**任何**发射 OSC 133 的 shell（自带或我们注入）都成立。Phase B 是重渲染工作，留作第二阶段。

---

## 3. Phase A 设计

### A1 · Shell 集成注入（接活 `cmdHintShellIntegration`）

目标：让本地 shell 可靠发射 OSC 133 `A`(prompt-start) / `B`(command-start) / `C`(pre-exec) / `D;<exit>`(done+退出码)。

**本地 shell（我们控制启动）——按 shell 注入，避免回显闪烁：**
- **bash**：`CommandBuilder` 加 `--rcfile <tmp>`，临时 rc 先 `source ~/.bashrc`（若存在）再追加：`PROMPT_COMMAND` 发 `\e]133;D;$?\a` + `\e]133;A\a`，`trap '...133;C' DEBUG` 发 `B`/`C`。
- **zsh**：设 `ZDOTDIR=<tmpdir>`，其 `.zshrc` 先 source 用户 zdotdir 再加 `precmd`(发 D;$? 与 A)/`preexec`(发 B/C) 函数。
- **fish**：`--init-command` 或注入 `function fish_prompt`/`fish_preexec`/`fish_postexec` 发对应序列。
- **pwsh / cmd / wsl**：v1 **不注入**（pwsh 可后续用 profile；记为限制）。
- 临时文件由后端生成、随会话清理；仅当 `cmdHintShellIntegration` 开启时启用。
- 备选（若 rcfile/env 难统一）：连接后向 pty 写一段 `eval` 一行式（接受首行一次性回显）——作为 fallback。**推荐 rcfile/env 路线**。

**远端 SSH**：best-effort——同一 `cmdHintShellIntegration` 开关下，连接后向通道写 bash/zsh 集成片段（依赖远端 shell 类型，失败静默）。**文档标注：远端为尽力而为**。

> 设置项已存在，无需新增（避免 [[dual-appsettings-sync]] 双写）；仅需把它接到注入逻辑。本地默认可考虑置 true（让 block 开箱即用）——作为待确认项。

### A2 · 命令区间模型 + xterm markers

扩展 OSC 133 handler（不破坏现有历史逻辑）：
- 维护 per-tab `CommandBlock[]`：
  ```ts
  interface CommandBlock {
    promptMarker: IMarker;     // term.registerMarker() at prompt/command start (A/B)
    outputMarker?: IMarker;    // at pre-exec (C)
    command: string;           // from existing inputBuffer captured at C
    exitCode?: number;         // parsed from D payload "D;<code>"
    state: 'running' | 'done';
    startedAt: number;
  }
  ```
- 在 `A`/`B`：`term.registerMarker()` 记录命令起点，新建 block（state running）。
- 在 `C`：记录 outputMarker + command 文本（复用现有 `inputBuffers`）。
- 在 `D`：解析 `payload` 取退出码（`D;0` / `D;1`...），关闭当前 block（state done, exitCode）。
- 存储：`tabBlocks: Map<tabId, CommandBlock[]>`（与现有 per-tab 全局 map 风格一致）；上限保留最近 N（如 200）防泄漏；marker 失效（行被裁剪）时清理。

### A3 · 左侧状态条 decorations

用 `term.registerDecoration({ marker })` 给每个 block 在**左边距**画一条状态条：
- running → `--accent-primary`（脉冲/半透明）；exit 0 → `--success`；exit≠0 → `--danger`。
- 宽度 ~3px，靠左 gutter；hover 高亮。点击/hover 暴露该命令的操作（A4）。
- 全部用 P1 令牌色；decoration 元素加 class，样式在 global.css。
- 仅当该 tab 有 OSC 133（`tabHasOsc133`）时启用，否则静默不画（普通终端不受影响）。

### A4 · 命令导航 + 单命令操作

- **导航**：上一条/下一条命令——滚动到相邻 block 的 promptMarker（`term.scrollToLine(marker.line)`）。绑两个 keymap 动作（如 `block.prev`/`block.next`，默认绑定待定）+ 可选在终端工具条加按钮。
- **单命令操作**（hover 状态条或右键 block 区域弹出小菜单）：
  - 复制命令（block.command）
  - 复制输出（outputMarker.line → 下一个 block.promptMarker.line 之间的 buffer 文本，用 `term.buffer.active` 读取行）
  - 重跑（把 command 写回当前输入）
- 这些是"轻量 block 体验"，不改渲染、不画卡片。

---

## 4. Phase B（不在本期，仅勾勒）

- 把每个 block 的命令+输出在视觉上**框成卡片**（圆角、命令为粘性头、退出码角标、可折叠/展开）。
- 技术路径：xterm 不原生支持"卡片"，需用 decorations 叠加边框/背景层，或在命令边界插入分隔装饰 + overlay。重渲染、滚动同步、性能是难点 → 单独 spec、单独评估。

---

## 5. 影响文件

| 文件 | 改动 |
|---|---|
| `src-tauri/src/pty.rs`（+ ssh 路径） | 按 shell 注入集成脚本（rcfile/env/临时文件）；gated by 设置 |
| `src-tauri/src/lib.rs` | 传递"是否注入"标志 / 生成临时集成文件命令 |
| `src/components/Terminal/TerminalView.tsx` | OSC 133 handler 扩展：markers、退出码、CommandBlock 模型；decorations；导航/复制操作；清理 |
| `src/keymap/actions.ts` | `block.prev`/`block.next` 动作 |
| `src/styles/global.css` | 状态条 decoration + 单命令小菜单样式（令牌） |
| `src/i18n/locales/gwshell.{en,zh}.json` | 导航/复制命令/复制输出/重跑 文案 |
| `src/stores/settingsStore.ts` | 接活 `cmdHintShellIntegration`（仅消费，不新增字段） |

---

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| **注入跨 shell/平台脆弱**（最大风险） | 仅 bash/zsh/fish 本地，用 rcfile/env 干净注入；pwsh/cmd v1 跳过；远端 best-effort + 文档标注；全程 gated by 开关，关闭则完全旧行为 |
| 集成脚本污染用户 rc / 回显闪烁 | rcfile/env 先 source 用户配置再追加；不用 eval 回显路线（仅 fallback） |
| marker 随滚动裁剪失效 | marker `onDispose` 清理对应 block + decoration；保留上限 N |
| decorations 多导致性能 | 仅 OSC 133 tab 启用；每命令一个轻量元素；超上限回收 |
| 退出码格式差异（`D` 无码/有码） | `D` 无码按 done 处理、状态中性；有码才上色 |
| 与现有命令历史/补全逻辑冲突 | 扩展而非替换 handler；历史路径不动 |

---

## 7. 验证

1. `npm run build` + `npm run smoke:check` + `cargo build` 通过。
2. 真应用（需真 shell）：本地开 bash/zsh，开启 shell 集成 → 每条命令左侧出现状态条；成功绿/失败红/运行中；上一条/下一条命令跳转；复制命令/输出/重跑可用；关闭集成则恢复普通终端。
3. 浏览器桩仅能验证编译与"无 OSC 133 时不画"——真 block 需真 shell。
4. 回归：命令历史/ghost 补全仍正常；普通（无集成）终端无任何变化。

---

## 8. 不在 P4（Phase A）范围

- Phase B block 卡片视觉。
- pwsh/cmd 本地注入、远端强保证注入。
- Warp 式自研渲染 / 输出语义解析。
- 真·OS vibrancy（P-future）。
