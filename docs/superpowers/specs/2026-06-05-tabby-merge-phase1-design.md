# 合并 Tabby 可借鉴功能 · Phase 1 设计:命令体验核心

- 日期:2026-06-05
- 状态:已批准设计,待写实现计划
- 范围:Phase 1 = 自动补全打磨 + 快捷命令片段库

---

## 0. 背景与关键发现

用户希望"参考开源项目 Tabby,把能合并的功能都合并进来,比如输入自动补全"。

调研(通读 Tabby 源码 `tabby-terminal/src/api/baseTerminalTab.component.ts` 全 925 行、xterm 前端,以及讨论区 #6332 / #9577)得出一个关键结论:

> **Tabby 没有内置的命令自动补全。** 它是纯透传终端,作者明确表态"自动补全是 shell 的事,不是终端的事"。用户看到的灰色 ghost text 来自远程 shell(zsh-autosuggestions / fish / PSReadLine),Tabby 只是把字节显示出来。

因此"从 Tabby 移植自动补全"不成立——没有可移植的实现。而 **gwshell 反而领先**:它已经自建了 ghost-text + SQLite 命令历史补全(`TerminalView.tsx` / `commandHistory.ts` / `history.rs`),这是 Tabby 故意不做的功能。

所以本工作拆成两条真实可做的线:
1. **打磨 gwshell 已有的自动补全**(借鉴行业通行技术:OSC 133 shell 集成、频率+时近排序、多候选)。
2. **合并 Tabby 真正值得移植的命令类功能**:快捷命令/片段库(`tabby-quick-cmds`),这是 Tabby 生态里最契合 gwshell 写入路径的命令功能,也是后续阶段"登录脚本"的前置。

## 0.1 整体路线图(已批准,本 spec 只覆盖 Phase 1)

| 阶段 | 内容 |
|---|---|
| **Phase 1(本文)** | 自动补全打磨 + 快捷命令片段库 |
| Phase 2 | Tier A 余下(纯前端低风险):终端内搜索、粘贴安全、Quick Connect、主题预设+连字 |
| Phase 3 | Tier B:输入广播、命令/连接面板、可配置快捷键含 chord、会话/标签重启恢复、端口转发规则+SOCKS、SSH 跳板机+登录脚本、分组默认继承 |
| Phase 4 | Tier C:Quake 下拉控制台、主密码加密保险库、标签↔面板互转+嵌套分屏、agent 转发、Zmodem |

每个阶段各自独立走 spec → 计划 → 实现。

---

## 1. 现状(已在源码核实)

### 1.1 自动补全现状
- `src/lib/commandHistory.ts`:内存数组 `history`(oldest→newest);`getSuggestion(prefix)` 从最新往旧扫,返回**第一个** `startsWith(prefix)` 命中的后缀。**单候选、纯前缀、最近优先,无排序、无 fuzzy。**
- `src-tauri/src/history.rs`:`load_history` = `SELECT command FROM command_history GROUP BY command ORDER BY MAX(ts) DESC LIMIT n`(全局去重);`save_command` 插入 + 截断到 10000 行。**全局,无 cwd/host/类型作用域。**
- `src-tauri/src/database.rs`:`command_history(id, command, ts)` + `idx_cmd_ts`(`init_tables` 第 46-51 行)。
- `src/components/Terminal/TerminalView.tsx`:
  - `onData`(883-942 行):**仅 `tab.type === 'ssh'` 且 `settings.sshHistoryCmd`** 时,用 per-tab `inputBuffers` 启发式重建命令行,回车 `record`,每次按键 `getSuggestion` 算 ghost。处理的控制键有限(`\r`/`\n`、`\x7f` 退格、`\x15` Ctrl-U、ESC 序列 + Ctrl-A/E/K/W/L 仅清 ghost)。
  - ghost 接受回调 `ghostAcceptCallbacks`(945-960 行):把后缀塞进 `inputBuffers` 并追加进 `writeQueue`。
  - 接受键(624-655 行,`attachCustomKeyEventHandler`):SSH 且有 ghost 时,`Tab` / `ArrowRight` 接受。
  - ghost 叠层 JSX:约 1391 行,用 cell-size CSS 变量定位。
- `src/stores/settingsStore.ts`:相关开关 `terminalCmdHint`(默认 false)、`sshHistoryCmd`(默认 true)、`sshHistoryCmdStorage`('local')、`sshHistoryCmdLoadCount`('100')。`save()` 在 `sshHistoryCmd` 为真时调 `commandHistory.init(count)`。
- IPC:`get_command_history(limit)` / `save_command_history(command)`(`lib.rs` 594-617),注册在 `invoke_handler!`(`lib.rs` 792-843,末尾两项)。

**已核实的局限**:单候选、纯前缀;历史全局无作用域(host A 上的 `ls` 会被建议到所有主机);启发式行重建在复杂编辑/粘贴/远程回显时会错位;只对 SSH 生效;远程 shell 若也开了 autosuggest 会出现双重灰字。

### 1.2 写入路径与可复用机制
- 每个 `TerminalView` effect 内有 `writeQueue` + `flushWrites()` + `invokeWrite()`,按会话类型分别打 `write_to_pty` / `write_to_ssh` / `write_to_serial`(`lib.rs` 142 / 267 / 551)。
- `ghostAcceptCallbacks: Map<tabId, fn>` 已经示范了"从组件外向某 tab 注入输入"的模式——片段发送将泛化此模式。
- 模块级 per-tab Map(`terminalInstances` / `tabListenerCleanups` / `inputBuffers` / `ghostTextState` / `ghostTextSetters` / `ghostAcceptCallbacks`)在 React 重渲染/分屏切换间存活。**关键不变量:每个 tab id 只能有一套事件监听,重新挂载前必须 `cleanupTabListeners()`。**

### 1.3 侧栏 UI 模式
- `src/App.tsx`:布局 `TitleBar + Sidebar(IconNav) + SessionPanel + 主区`。
- `src/components/Sidebar/IconNav.tsx`:`navItems` 数组 + `handleNavClick` switch;`activeNavItem` 控制高亮。
- `src/components/Sidebar/SessionPanel.tsx`:面板组件示范(`sidebarCollapsed` 时返回 null,列表 + 右键菜单 + 增删)。
- 持久化模式(可镜像):`sessions(id, data)` 表 + `save_session` / `get_sessions` / `delete_session`,data 列存 JSON。

---

## 2. Phase 1 设计

### A. 自动补全打磨

#### A1. 后端历史存储升级(`database.rs` / `history.rs`)

**Schema 迁移**(`init_tables`):在 `CREATE TABLE IF NOT EXISTS command_history` 之后,追加幂等迁移——对每个新列执行 `ALTER TABLE command_history ADD COLUMN ...`,吞掉"duplicate column name"错误:
- `cwd TEXT NOT NULL DEFAULT ''`
- `scope TEXT NOT NULL DEFAULT ''`(SSH=host;localshell=`local`;serial=端口名;docker=容器标识)
- `session_type TEXT NOT NULL DEFAULT ''`

旧行新列自动取默认空值,完全向后兼容。**频率不另存列**——每次执行 INSERT 一行,排序时用 `COUNT(*)` 当频率、`MAX(ts)` 当时近。

**`history.rs`**:
- 定义 `HistoryEntry { command, cwd, scope, session_type, count, last_used }`(`serde::Serialize`)。
- `load_history(conn, limit) -> Vec<HistoryEntry>`:
  ```sql
  SELECT command, cwd, scope, session_type, COUNT(*) AS count, MAX(ts) AS last_used
  FROM command_history GROUP BY command, scope, cwd
  ORDER BY last_used DESC LIMIT ?1
  ```
  作用域加权放到前端做(数据量小,内存里算更灵活),这里只负责把结构化条目吐出来。
- `save_command(conn, command, cwd, scope, session_type)`:INSERT 五字段 + 维持 10000 行截断逻辑不变。

#### A2. 前端排序 + 多候选(`commandHistory.ts`)

- 内存改存 `HistoryEntry[]`(一次性载入,**不做每按键 IPC**)。
- `getSuggestions(prefix, ctx: { scope?, cwd? }) -> string[]`(返回**完整命令**候选,排序后):
  - 过滤:`command.startsWith(prefix) && command.length > prefix.length`。
  - 评分(fish 风格):`score = log2(count+1) × recencyDecay(now - last_used) + scopeBoost + cwdBoost`,其中同 `scope` 命中加权、同 `cwd` 命中再加权;不同 scope 仍可出现但排后(保证跨主机仍有兜底)。
  - 去重(同 command 取最高分),按 score 降序返回前 N(如 8)。
- **ghost 后缀**:渲染候选 `i` 时,显示后缀 = `candidates[i].slice(prefix.length)`,写入 `ghostTextState`;`ghostAcceptCallbacks` 仍只吃后缀,接受语义不变。
- 保留 `getSuggestion(prefix)` 作为"取 `getSuggestions(prefix, {})[0]` 再切后缀"的薄封装,兼容旧调用点。
- `record(command, ctx)`:本地 push + `invoke('save_command_history', { command, cwd, scope, sessionType })`。

#### A3. 混合捕获(`TerminalView.tsx`)

**(a) 加固启发式 `onData` 行重建**(在现有 893-930 块内扩展):
- 新增处理:bracketed paste(`\x1b[200~ … \x1b[201~` 之间的内容并入 buffer)、Ctrl-W(`\x17`)真正删一个词(而非仅清 ghost)、Home/End。
- 把"仅 SSH"门槛去掉(见 A4)。

**(b) OSC 序列**:在终端创建处注册解析器,dispose 接入既有清理:
- `term.parser.registerOscHandler(133, handler)`:解析 FinalTerm/iTerm2 标记 `A`(prompt-start)/`B`(command-start)/`C`(command 执行前,即输入结束)/`D`(命令结束带退出码)。**检测到 OSC 133 时**:以它为权威——在 `C`/`D` 时用标记间文本记录命令并重置启发式 buffer,优先于 `onData` 重建。
- `term.parser.registerOscHandler(7, handler)`:解析 `file://host/path` 形式的 cwd 上报,更新该 tab 的当前 cwd(供 A1/A2 作用域用)。
- per-tab 增 `tabCwd: Map<tabId, string>`、`tabHasOsc133: Map<tabId, boolean>`(模块级,随 cleanup 清理)。

**(c) 本地 shell 集成脚本注入(opt-in,Phase 1 默认关)**:
- 新设置开关(见 A6)。开启时,对 `localshell` 会话在启动后注入对应 shell 的集成片段(bash/zsh 设 `PROMPT_COMMAND`/`precmd` 发 OSC 133+OSC 7;fish 用 `fish_prompt`;PowerShell 原生支持)。
- Phase 1 只搭好开关 + 注入骨架,默认不动用户环境;远程 SSH **不**自动注入(无法可靠注入,依赖对端自配)。

#### A4. 扩展到所有会话类型
- `onData` 捕获/补全门槛从 `tab.type === 'ssh'` 改为 `isInteractiveTerminal(tab.type)`(ssh / localshell / serial / docker)。
- `ghostAcceptCallbacks` 注册同样去掉 SSH 限制。
- 接受键判断(624-635 行)同步改为按 `isInteractiveTerminal` 而非硬编码 `'ssh'`。
- scope 计算:ssh=会话 host,localshell=`local`,serial=端口名,docker=容器标识。
- 沿用现有 `sshHistoryCmd` 开关键名(不改键、不做设置迁移),语义泛化为"命令历史提示"。

#### A5. 激进清除 + 多候选循环 + 双 ghost
- **清除时机**:编辑(已做)、粘贴、回车(已做)、光标移动(↑↓←→/Home/End)、`writeDisposed`(已做)、失焦。补齐粘贴与光标移动两类。
- **多候选循环**:有 ghost 时,`↓` / `Ctrl-N` 切下一候选、`↑` / `Ctrl-P` 切上一候选(在 `attachCustomKeyEventHandler` 内拦截,维护一个 per-tab `candidateIndex`);`Tab` / `→` 接受当前候选(已有)。
- **双 ghost 抑制**:当某 tab `tabHasOsc133` 为真(远程/本地 shell 自带集成,很可能也有 autosuggest),且新设置"检测到远程提示时让位"开启,则不渲染客户端 ghost。默认关闭(仍显示客户端 ghost)。

#### A6. 设置项(`settingsStore.ts` + SettingsModal)
新增(均加进 `AppSettings`、`defaultSettings`,SettingsModal 加行,i18n 加键):
- `cmdHintAllSessions: boolean`(默认 true)——补全是否对非 SSH 会话生效。
- `cmdHintShellIntegration: boolean`(默认 false)——本地 shell 集成脚本注入(A3c)。
- `cmdHintDeferToRemote: boolean`(默认 false)——检测到 shell 集成时让位远程补全(A5)。
- `cmdHintScopeByHost: boolean`(默认 true)——作用域加权(A2)。

> 设计取舍:键名保持新增,绝不重命名旧键,避免设置迁移。
> 待实现时确认:现有 `terminalCmdHint`(默认 false)当前未被 `onData` 读取,用途存疑——实现阶段先查清它的真实消费点,**不**擅自重新定义其语义(若确为无用旧旗,单列处理,不在本 spec 顺带改)。

### B. 快捷命令片段库

#### B1. 数据模型 + store
- `src/types/index.ts` 加 `Snippet { id: string; name: string; command: string; group?: string; createdAt: number }`。
- 新 `src/stores/snippetStore.ts`(Zustand):
  - state:`snippets: Snippet[]`、`loaded: boolean`。
  - actions:`load()`、`add(s)`、`update(s)`、`remove(id)`、`reorder(ids)`。每个变更同时打后端 IPC(镜像 appStore 的"状态变更即副作用"模式)。
- 后端(镜像 sessions):
  - `database.rs`:`CREATE TABLE IF NOT EXISTS snippets (id TEXT PRIMARY KEY, data TEXT NOT NULL)` + `save_snippet` / `get_snippets` / `delete_snippet` 方法(data 列存整条 JSON)。
  - `lib.rs`:三个 `#[tauri::command]`(`save_snippet` / `get_snippets` / `delete_snippet`),并加进 `invoke_handler!`(792-843)。

#### B2. 侧栏面板(`components/Sidebar/SnippetPanel.tsx`)
- `IconNav.tsx`:`navItems` 加 `{ id: 'snippets', icon: Code, labelKey: 'nav_snippets' }`;`handleNavClick` 加 `case 'snippets'` → 展开/设为 `activeNavItem`。
- `App.tsx`:在 `SessionPanel` 旁条件渲染 `SnippetPanel`(按 `activeNavItem === 'snippets'`),沿用 `sidebarCollapsed` 返回 null 的约定。
- 面板内容:片段列表(可按 `group` 折叠,复用 SessionPanel 的分组/右键模式)、新增/编辑/删除(内联表单或小弹窗)、每条一个"发送"按钮 → 注入当前活动终端。
- i18n:`nav_snippets`、`snippet_*` 系列键加进 `gwshell.en.json` / `gwshell.zh.json`。

#### B3. 发送机制(转义展开)
- **泛化注入通道**:在 TerminalView 的 effect 内,与 `ghostAcceptCallbacks` 同处注册 `tabInputSenders: Map<tabId, (data: string) => void>`,内部走同一 `writeQueue` + `flushWrites()`(因此自动复用 `write_to_pty/ssh/serial`、背压、重试)。cleanup 时一并删除。
- **片段展开**(`src/lib/snippetExpand.ts`):把片段文本解析成"发送片段 + 延迟"序列:
  - `\xNN` → 单个十六进制控制字节(如 `\x03` = Ctrl-C)。
  - `\sNNN` → 延迟 NNN 毫秒(把文本切成多段,段间用 `setTimeout` 调度,期间持续调 `tabInputSenders`)。
  - `\n` / `\r` / `\t` / `\\` → 常规转义。
- **目标**:Phase 1 只发**当前活动终端**(`activeTabId`);若无活动终端或其未连接,按钮禁用并提示。广播到全部面板留 Phase 3。

---

## 3. 数据流

**补全(每次按键)**:`xterm onData` → 加固后的启发式 buffer(或 OSC 133 权威捕获)→ `commandHistory.getSuggestions(prefix, {scope, cwd})`(纯内存排序)→ `ghostTextState` + `ghostTextSetters` 渲染叠层。回车 → `commandHistory.record(cmd, ctx)` → `save_command_history` IPC → SQLite 多字段插入。

**接受/循环**:`attachCustomKeyEventHandler` 拦 `Tab`/`→`(接受)、`↓↑`/`Ctrl-N/P`(循环)→ `ghostAcceptCallbacks` 注入后缀走 `writeQueue`。

**片段发送**:SnippetPanel 点"发送" → `snippetExpand()` 产出片段+延迟序列 → `tabInputSenders.get(activeTabId)` 逐段(含延迟)注入 → 同一 `writeQueue` → 后端写入路径。

---

## 4. 错误处理与边界
- **Schema 迁移**:`ALTER TABLE ADD COLUMN` 用 `match`/`let _ =` 吞掉"列已存在"错误;首启即幂等。
- **IPC 兼容**:所有现有命令名不变,只新增 `save_snippet`/`get_snippets`/`delete_snippet`;`save_command_history` 增参数(`cwd`/`scope`/`sessionType`)——前端旧无参调用点全部更新;后端参数用 `#[serde(default)]` 容错。
- **监听不变量**:`tabInputSenders`、两个 OSC handler、`tabCwd`/`tabHasOsc133`/`candidateIndex` 全部在既有 setup/cleanup 生命周期内注册与释放;OSC handler 的 dispose 句柄存入该 tab 的 cleanup 列表。
- **写后即失效**:注入前判 `writeDisposed`(沿用 `ghostAcceptCallbacks` 的守卫)。
- **片段延迟竞态**:`\sNNN` 的 `setTimeout` 链需在 tab 关闭/`writeDisposed` 时取消(per-tab 记录 timer id,cleanup 清除),避免向已销毁会话写入。

---

## 5. 测试计划(无自动化测试框架)

**静态把关**:`npm run build`(tsc 类型检查 + 前端构建)、`npm run smoke:check`、`cargo check`(后端)。

**手动测试清单**:
1. SSH 会话:输入命令前缀 → 出现**排序**ghost(频率高/最近用的优先);`↓` 循环候选;`Tab`/`→` 接受。
2. 本地 shell / serial 会话:同样能捕获与补全(验证 A4 泛化)。
3. 作用域:在 host A 执行若干命令,切到 host B,确认 A 的命令排在 B 自身历史之后(`cmdHintScopeByHost` 开启时)。
4. OSC 133:在开启 shell 集成的本地 shell 下,确认命令被精确捕获(粘贴含空格/控制键的复杂命令不再错位)。
5. 清除:粘贴、按方向键、回车后 ghost 立即消失,无残影。
6. 片段:新增/编辑/删除片段并持久化(重启后仍在);点"发送"注入当前终端;`\x03`(Ctrl-C)、`\s500`(延迟)、`\n` 转义按预期生效;无活动终端时按钮禁用。
7. 回归:`sshHistoryCmd` 关闭时彻底无补全;分屏(2/4/6/8 pane)切换后监听仍唯一、无重复注入。

---

## 6. 落点文件清单
**后端**:`src-tauri/src/database.rs`(迁移 + snippets 表 + 方法)、`src-tauri/src/history.rs`(HistoryEntry + 多字段查询/写入)、`src-tauri/src/lib.rs`(扩展 `save_command_history` 签名;新增 snippet 三命令;`invoke_handler!` 注册)。

**前端**:`src/lib/commandHistory.ts`(结构化 + 排序 + 多候选)、`src/lib/snippetExpand.ts`(新)、`src/components/Terminal/TerminalView.tsx`(混合捕获、泛化会话、循环候选、清除、`tabInputSenders`、OSC handlers)、`src/stores/snippetStore.ts`(新)、`src/stores/settingsStore.ts`(4 个新开关)、`src/components/Sidebar/IconNav.tsx`(导航项)、`src/components/Sidebar/SnippetPanel.tsx`(新)、`src/App.tsx`(渲染面板)、`src/components/Settings/SettingsModal.tsx`(设置行)、`src/types/index.ts`(Snippet 类型)、`src/i18n/locales/gwshell.{en,zh}.json`(键)。

---

## 7. 已定默认值(设计批准时确认)
1. 本地 shell 集成脚本注入 = opt-in,默认关(`cmdHintShellIntegration: false`)。
2. 补全泛化到所有会话类型,沿用 `sshHistoryCmd` 开关键名。
3. 双 ghost 抑制 = 可配置,默认仍显示客户端 ghost(`cmdHintDeferToRemote: false`)。
4. 片段 Phase 1 只发当前活动终端,广播留 Phase 3。
