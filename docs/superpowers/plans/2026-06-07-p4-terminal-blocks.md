# P4 终端 Block 化（Phase A）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Phase A——让本地 shell 可靠发射带退出码的 OSC 133（接活 `cmdHintShellIntegration`，默认关），前端用 xterm markers/decorations 把命令边界做成轻量 block：左侧状态条（绿/红/运行中）+ 命令上下跳转 + 复制命令/输出/重跑。不改渲染、不画卡片（Phase B 后续）。

**Architecture:** 后端按 shell 用 rcfile/env 注入集成脚本（bash/zsh/fish 本地；SSH best-effort 写通道）；前端扩展现有 OSC 133 handler 建 `CommandBlock[]`（markers + 退出码），用 decorations 画 gutter 状态条，加导航/复制操作。全部 P1 令牌。

**Tech Stack:** Tauri 2 (Rust pty/ssh) + xterm v6（markers/decorations）+ React/TS。

**测试现实:** 无自动化测试，且**注入与 block 需真交互式 shell 才能完整验证**（浏览器桩只能验证编译 + "无 OSC133 时不画"）。每 task：`cargo build`/`npm run build`/`smoke` + 真 shell 人工。

**参考 spec:** `docs/superpowers/specs/2026-06-07-p4-terminal-blocks-design.md`

**关键现状（已探查）:** OSC 133 已在 `TerminalView.tsx:943` 解析（仅用于历史，忽略 'D'/不建 markers）；`cmdHintShellIntegration` 是死设置（无消费）；本地 shell 经 `create_local_shell`(前端 :1330) → 后端命令(`shell_name`) → `pty::resolve_shell`。

---

## 文件结构

| 文件 | 改动 |
|---|---|
| `src-tauri/src/pty.rs` | `resolve_shell` 接受注入标志，按 shell 生成临时 rc/init 并设 args/env；临时文件清理 |
| `src-tauri/src/lib.rs` | `create_local_shell` 命令加 `shell_integration: bool` 参数并下传 |
| `src/components/Terminal/TerminalView.tsx` | invoke 传 `shellIntegration`；OSC 133→CommandBlock 模型+markers+退出码；gutter decorations；导航/复制操作；清理 |
| `src/components/Terminal/blocks.ts` | 新增：CommandBlock 类型 + per-tab 存储 + 读输出文本工具 |
| `src/keymap/actions.ts` | `block.prev` / `block.next` |
| `src/styles/global.css` | `.gw-block-deco-*` 状态条 + 单命令小菜单（令牌） |
| `src/i18n/locales/gwshell.{en,zh}.json` | 复制命令/复制输出/重跑/上一条/下一条 |
| `src/stores/settingsStore.ts` | 仅**消费** `cmdHintShellIntegration`（不新增字段） |

---

## Task 1: 本地 shell 集成注入（bash/zsh/fish）

**Files:** `src-tauri/src/pty.rs`, `src-tauri/src/lib.rs`, `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: 读链路**

Read：`lib.rs` 的 `create_local_shell` 命令（约 :110，参数含 `shell_name`）、它如何调用 pty start；`pty.rs::resolve_shell`(:65 win / :108 unix) 与 start。确认 CommandBuilder 如何设 `.arg()`/`.env()`、临时文件可写位置（用 `std::env::temp_dir()`）。

- [ ] **Step 2: 后端命令加注入标志**

`lib.rs`：`create_local_shell` 加参数 `shell_integration: bool`（serde 默认 false），下传到 pty start → `resolve_shell`。

- [ ] **Step 3: 按 shell 生成集成（pty.rs）**

`resolve_shell(name, shell_integration)`：当 `shell_integration` 为真且 shell ∈ {bash,zsh,fish} 时，生成临时集成文件并设对应 args/env；否则原样。其它 shell（pwsh/cmd/wsl）忽略标志。集成脚本（写入 temp_dir，文件名带 session/uuid，发射 OSC 133）：

**bash** —— 临时 rc，bash 加 `--rcfile <path>`：
```bash
[ -f ~/.bashrc ] && source ~/.bashrc
__gw_precmd() { local e=$?; printf '\033]133;D;%s\007' "$e"; }
case "$PROMPT_COMMAND" in *__gw_precmd*) ;; *) PROMPT_COMMAND='__gw_precmd'${PROMPT_COMMAND:+';'$PROMPT_COMMAND} ;; esac
PS1='\[\033]133;A\007\]'"$PS1"'\[\033]133;B\007\]'
PS0='\[\033]133;C\007\]'"$PS0"
```

**zsh** —— 临时目录作 `ZDOTDIR`，写其中 `.zshrc`，并设 env `ZDOTDIR=<tmpdir>`、保存原值到 `__gw_user_zdotdir`：
```zsh
[ -f "${__gw_user_zdotdir:-$HOME}/.zshrc" ] && source "${__gw_user_zdotdir:-$HOME}/.zshrc"
autoload -Uz add-zsh-hook
__gw_preexec() { print -n '\033]133;C\007' }
__gw_precmd()  { print -n "\033]133;D;$?\007\033]133;A\007" }
add-zsh-hook preexec __gw_preexec
add-zsh-hook precmd  __gw_precmd
```
（注：还需让 zsh 读到我们的 ZDOTDIR——设 env 即可；A 也可由 precmd 发，B 省略时前端用 A 作命令起点。）

**fish** —— 用 `fish --init-command='...'`：
```fish
function __gw_pre --on-event fish_preexec; printf '\033]133;C\007'; end
function __gw_post --on-event fish_postexec; printf '\033]133;D;%s\007' $status; end
function __gw_prompt --on-event fish_prompt; printf '\033]133;A\007'; end
```

> ⚠️ 这些脚本是**起点**，OSC 133 在各 shell 的精确时序（A/B/C/D 位置、退出码捕获）**必须在真 shell 上验证微调**（见终验）。不要用向 pty 写 eval 的回显路线。

- [ ] **Step 4: 前端传标志**

`TerminalView.tsx:1330` 的 `invoke("create_local_shell", {...})` 加 `shellIntegration: useSettingsStore.getState().settings.cmdHintShellIntegration`。

- [ ] **Step 5: 验证 + Commit**

Run: `cd src-tauri && cargo build`；`cd .. && npm run build`（分类器可能挡 node 类命令，挡则据读校验，勿超 ~2 次）。
（真 shell 验证留终验。）
```bash
git add src-tauri/src/pty.rs src-tauri/src/lib.rs src/components/Terminal/TerminalView.tsx
git commit -m "feat(terminal): inject OSC133 shell integration for local bash/zsh/fish (P4)"
```

---

## Task 2: 远端 SSH best-effort 注入

**Files:** `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: 连接后写集成片段**

在 SSH 连接建立后（复用 `init_command` 写入点附近，约 :1371），当 `settings.cmdHintShellIntegration` 为真时，向通道写一段**单行、静默**的 bash/zsh 兼容片段（同 T1 的 hook，但合成一行 `eval`），失败静默。例如对 POSIX shell：
```
printf '%s' '<oneliner that defines precmd/preexec via PROMPT_COMMAND/PS0/PS1>' | source /dev/stdin 2>/dev/null
```
（远端 shell 类型未知 → best-effort；只发一次；不报错。）标注为尽力而为。

- [ ] **Step 2: 验证 + Commit**

Run: `npm run build`。
```bash
git add src/components/Terminal/TerminalView.tsx
git commit -m "feat(terminal): best-effort OSC133 integration over SSH (P4)"
```

---

## Task 3: 命令区间模型 + markers + 退出码

**Files:** Create `src/components/Terminal/blocks.ts`; Modify `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: blocks.ts 模型**

```ts
import type { Terminal, IMarker } from '@xterm/xterm';

export interface CommandBlock {
  id: number;
  promptMarker: IMarker | null;   // command start (A/B)
  outputMarker: IMarker | null;   // pre-exec (C)
  command: string;
  exitCode?: number;
  state: 'running' | 'done';
  startedAt: number;
}

const MAX_BLOCKS = 200;
const tabBlocks = new Map<string, CommandBlock[]>();
let seq = 0;

export function blocksFor(tabId: string): CommandBlock[] { return tabBlocks.get(tabId) ?? []; }
export function startBlock(tabId: string, term: Terminal): CommandBlock { /* registerMarker, push, trim to MAX_BLOCKS (dispose oldest markers) */ }
export function markOutput(tabId: string, term: Terminal): void { /* set outputMarker on last running block */ }
export function setCommand(tabId: string, cmd: string): void { /* last running block.command */ }
export function finishBlock(tabId: string, exitCode?: number): void { /* last running → done + exitCode */ }
export function clearTab(tabId: string): void { /* dispose markers + delete */ }
// read output text between outputMarker.line and next block's promptMarker.line (or buffer end)
export function readOutput(tabId: string, term: Terminal, block: CommandBlock): string { /* iterate term.buffer.active lines translateToString */ }
```
实现：trim 超过 MAX_BLOCKS 时 `dispose()` 最旧 block 的 markers；marker 为 null（裁剪失效）时跳过。

- [ ] **Step 2: 接到 OSC 133 handler（TerminalView ~:943）**

在现有 handler 内（**不动历史逻辑**）追加：
- `A`/`B`：`startBlock(tab.id, term133)`（B 若紧随 A 可只在 A 建、B 忽略——按真 shell 行为，二选一避免重复建块；建议在 A 建块、B 跳过）。
- `C`：`markOutput(tab.id, term133)`；`setCommand(tab.id, (inputBuffers.get(tab.id) ?? '').trim())`。
- `D`：解析退出码 `const m = payload.match(/^D(?:;(\d+))?/); finishBlock(tab.id, m?.[1] ? Number(m[1]) : undefined)`。
- tab 关闭清理处调用 `clearTab(tab.id)`（与现有 `tabHasOsc133.delete` 同位置）。

- [ ] **Step 3: 验证 + Commit**

Run: `npm run build && npm run smoke:check`。
```bash
git add src/components/Terminal/blocks.ts src/components/Terminal/TerminalView.tsx
git commit -m "feat(terminal): command-block model via OSC133 markers + exit code (P4)"
```

---

## Task 4: 左侧状态条 decorations

**Files:** Modify `src/components/Terminal/TerminalView.tsx`, `src/styles/global.css`

- [ ] **Step 1: 给每个 block 注册 decoration**

在 block 状态变化时（startBlock 后、finishBlock 后）为其 `promptMarker` 注册/更新 decoration：
```ts
const deco = term.registerDecoration({ marker: block.promptMarker, x: 0, width: 1 });
deco?.onRender((el) => {
  el.classList.add('gw-block-deco');
  el.classList.toggle('running', block.state === 'running');
  el.classList.toggle('ok', block.state === 'done' && block.exitCode === 0);
  el.classList.toggle('err', block.state === 'done' && (block.exitCode ?? 0) !== 0);
});
```
存 decoration 句柄随 block；block 回收/clearTab 时 `deco.dispose()`。仅当 `tabHasOsc133.get(tab.id)` 时启用。

- [ ] **Step 2: 样式（global.css，令牌）**
```css
.gw-block-deco{ width:3px; height:100%; border-radius:var(--radius-pill); margin-left:1px; }
.gw-block-deco.running{ background:var(--accent-primary); opacity:.6; }
.gw-block-deco.ok{ background:var(--success); }
.gw-block-deco.err{ background:var(--danger); }
```

- [ ] **Step 3: 验证（编译 + 桩"无OSC133不画"）+ Commit**

Run: `npm run build && npm run smoke:check`。桩：普通终端无状态条、无报错。
```bash
git add src/components/Terminal/TerminalView.tsx src/styles/global.css
git commit -m "feat(terminal): gutter status decorations per command block (P4)"
```

---

## Task 5: 命令导航 + 单命令操作 + i18n

**Files:** `src/keymap/actions.ts`, `src/components/Terminal/TerminalView.tsx`, `src/styles/global.css`, i18n

- [ ] **Step 1: 导航动作（keymap）**

`actions.ts` 加：
```ts
{ id:'block.prev', labelKey:'action_block_prev', defaultBinding: IS_MACOS ? 'Meta+Up' : 'Ctrl+Up', run: () => scrollToAdjacentBlock(-1) },
{ id:'block.next', labelKey:'action_block_next', defaultBinding: IS_MACOS ? 'Meta+Down' : 'Ctrl+Down', run: () => scrollToAdjacentBlock(1) },
```
`scrollToAdjacentBlock(dir)`：取活跃 tab 的 blocks，按当前视口找相邻 block 的 `promptMarker.line`，`term.scrollToLine(line)`。实现放 TerminalView 并导出给 actions（或经一个轻量 registry，参考现有 cycleTab 取 activeTab 的方式）。

- [ ] **Step 2: 单命令操作（hover 状态条弹小菜单）**

decoration 元素加 hover/点击 → 弹出小菜单（复制命令 / 复制输出 / 重跑）：
- 复制命令：`navigator.clipboard.writeText(block.command)`
- 复制输出：`readOutput(tab.id, term, block)` → clipboard
- 重跑：把 `block.command` 写回当前 shell（`invoke('write_to_pty'/ssh write, {data: block.command})`，不自动回车）
菜单容器加 class，样式见 Step 4。位置按 decoration 元素定位。

- [ ] **Step 3: i18n（两文件 en/zh）**
- `action_block_prev`/`action_block_next` —— 上一条命令/下一条命令
- `block_copy_cmd`(复制命令) / `block_copy_output`(复制输出) / `block_rerun`(重跑)

- [ ] **Step 4: 菜单样式（global.css，令牌玻璃，复用 .context-menu 风格）**

- [ ] **Step 5: 验证 + Commit**

Run: `npm run build && npm run smoke:check`。
```bash
git add src/keymap/actions.ts src/components/Terminal/TerminalView.tsx src/styles/global.css src/i18n/locales/gwshell.en.json src/i18n/locales/gwshell.zh.json
git commit -m "feat(terminal): block navigation + copy command/output + rerun (P4)"
```

---

## Task 6: 终验

- [ ] **Step 1:** `cd src-tauri && cargo build && cd .. && npm run build && npm run smoke:check` 全过。
- [ ] **Step 2: 真 shell 人工（`npm run tauri dev`）**——本任务核心验证：
  - [ ] 设置开启「注入 shell 集成」→ 本地开 bash：每条命令左侧出现状态条；成功绿 / 失败（如 `false`）红 / 运行中色
  - [ ] zsh、fish 同样生效（逐一在真 shell 验证 OSC 133 时序，必要时微调 T1 脚本）
  - [ ] 退出码正确（`true`→绿，`false`/`exit 1`→红）
  - [ ] 上一条/下一条命令跳转（⌘↑/⌘↓）滚到对应命令
  - [ ] 复制命令 / 复制输出 / 重跑可用
  - [ ] 关闭集成 → 完全恢复普通终端，无状态条、无残留；命令历史/ghost 补全仍正常
  - [ ] 用户 rc（别名/PS1）未被破坏（rcfile/ZDOTDIR 先 source 用户配置）
- [ ] **Step 3:** 按 `superpowers:finishing-a-development-branch` 收尾（或并入 PR #10 / 新 PR）。

---

## 自查（spec 覆盖）

- §A1 注入（本地） → T1 ✓；（远端 best-effort）→ T2 ✓
- §A2 模型+markers+退出码 → T3 ✓
- §A3 状态条 decorations → T4 ✓
- §A4 导航+操作 → T5 ✓
- i18n/样式 → T4/T5 ✓
- 验证（真 shell 为主） → T6 ✓
- Phase B 不在范围 ✓
