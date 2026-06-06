# 合并 Tabby 可借鉴功能 · Phase 3a 设计:多会话效率 + 登录脚本补全

- 日期:2026-06-06
- 状态:已批准设计,待写实现计划
- 范围:Phase 3a = 输入广播 + 命令/连接面板 + 登录脚本补全(Tier B 的纯前端低风险子集)
- 前置:Phase 1(命令补全+片段库)、Phase 2(粘贴安全+Quick Connect+主题预设)已合并到 main

---

## 0. 背景与范围裁剪

路线图 Phase 3(Tier B)原列 7 项。探查(very thorough)发现多项已实现或不适用:

| 原计划项 | 实际状态 | 结论 |
|---|---|---|
| SSH 跳板机(ProxyJump) | **已完整实现**(`ssh/connect.rs:31-68` 建 direct-tcpip 通道) | 移出 |
| 本地端口转发 | **已完整实现**(`ssh/forward.rs` + `start_tunnel`) | 移出 |
| 远程转发 / 动态 SOCKS | 远程转发死字段(`tunnel_type` 连接时不读)/ SOCKS 缺 | 留 Phase 3c(后端) |
| 可配置快捷键、会话恢复 | 缺(静态表 / `sessionTabMemory` 死开关) | 留 Phase 3b |
| 分组默认继承 | 缺(group 仅文件夹标签) | 留 Phase 3c |
| **输入广播** | 缺(基础设施 `tabInputSenders`/`sendInputToTab` 已就位) | **Phase 3a** |
| **命令/连接面板** | 缺(AppMenu "Quick Search" 项 no-op) | **Phase 3a** |
| **登录脚本** | 半实现:本地 shell `init_command` 已发(`TerminalView.tsx:1308`);SSH 未接;`serial_init_commands` 死 | **Phase 3a** |

**重要更正**:`splitCount`/`splitPanes` 在 `src/` 中**不存在**(仅一个无人应用的 CSS 类 `.terminal-split-grid`),即 **分屏功能并未实现**;`TerminalContainer` 渲染所有终端标签、仅显示活动标签(标签模型,非分屏)。故"广播到当前分屏面板"不成立,改为**广播到所有已连接终端标签**(Tabby 在标签模型下亦如此)。CLAUDE.md 的分屏描述是期望稿,与实际不符(本阶段不顺带改,仅记录)。

Phase 3a 三项**均为纯前端**,复用 IPC `write_to_ssh`/`write_to_serial`/`write_to_pty` 与 Phase 1/2 的 `sendInputToTab`/`expandSnippet`,**无 Rust 改动**。

---

## 1. 现状(已在源码核实)

- **每标签输入注入**:`src/components/Terminal/TerminalView.tsx` 模块级 `tabInputSenders: Map<string,(data)=>void>`,`export function sendInputToTab(tabId, data): boolean`(Phase 1 加,现仅片段面板用);每标签连接建立时注册其 sender;`onData` 处理键盘输入(历史捕获块 + `writeQueue` 写入)。
- **连接/init 模式**:本地 shell 在 `connectionReady=true` 后 `if (session?.init_command)` setTimeout 300ms → `invoke("write_to_pty",{sessionId,data:cmd+"\n"})`(`:1308-1313`);SSH 在 `await doSshConnect(session); connectionReady=true`(`:1338-1339`)后**无** init 发送(其后是 tunnel 块);serial 在 `:1373+` `serial_open`,无 init 发送。
- **标签连接状态**:`TabInfo.connected: boolean`;`appStore.updateTabConnected(id, connected)` 维护;`tabs` 数组反映连接态。
- **会话连接入口**:`SessionPanel.handleConnect(session)`(`:64-78`):有同会话标签则 `setActiveTab`,否则 `addTab({id:uuid, sessionId, title:name, type:session_type, connected:false})`。
- **片段发送(含转义)**:Phase 2 的 `src/lib/snippetExpand.ts` `expandSnippet(raw): SendSegment[]`(`{kind:'text'}` / `{kind:'delay',delayMs}`);`SnippetPanel.send` 用累计延时 + setTimeout 调度各段经 `sendInputToTab` 发出。
- **StatusBar**:`src/components/StatusBar/StatusBar.tsx` 用 `useAppStore` 取 `tabs/activeTabId`,渲染连接点/类型/版本/时间;有 `status-spacer`。是放广播开关的合适处。
- **AppMenu**:`src/components/AppMenu/AppMenu.tsx:85` "Quick Search" 项(`menu_quick_search`,显示 `Ctrl+Shift+F`)**无 onClick**。
- **App 根**:`src/App.tsx` 根部懒加载渲染各 modal(`{showX && <XModal/>}`),无全局 keydown。
- **辅助**:`isInteractiveTerminal(type)`(ssh/localshell/serial/docker)已在 TerminalView 定义并导出可复用思路(若未导出,Phase 3a 在需要处内联同等判断)。
- **设置已展示但未接的快捷键**:`settings_sc_broadcast`='Ctrl Shift B'、`menu_quick_search`='Ctrl+Shift+F'(静态展示)。Phase 3a 让这两个键真正生效。

---

## 2. Phase 3a 设计

### A. 输入广播(广播到所有已连接终端)

**A1 状态**(`appStore.ts`):
- 加 `broadcastInput: boolean`(默认 false)+ `toggleBroadcastInput: () => void`(`set(s => ({ broadcastInput: !s.broadcastInput }))`)。接口与实现各一处。

**A2 发送**(`TerminalView.tsx` `onData`):
- 在 `onData` 处理体内(历史捕获块之后、正常 `writeQueue` 写入附近)加:
```
const st = useAppStore.getState();
if (st.broadcastInput) {
  for (const tb of st.tabs) {
    if (tb.id !== tab.id && tb.connected && isInteractive(tb.type)) sendInputToTab(tb.id, data);
  }
}
```
- 活动(聚焦)终端照常把 `data` 写入自己的 `writeQueue`;广播只是**额外**发给其它已连接标签。无回环(只有聚焦终端的 onData 由键盘触发;`sendInputToTab` 不触发 onData)。
- `isInteractive` = `type === 'ssh' || 'localshell' || 'serial' || 'docker'`(复用或内联)。

**A3 UI**:
- `StatusBar.tsx`:加广播开关按钮(lucide 图标如 `Radio`/`Megaphone`),`onClick={toggleBroadcastInput}`,`broadcastInput` 时高亮(class `active`)。仅当存在 ≥1 个已连接交互标签时显示(否则隐藏)。可显示目标数(已连接交互标签计数)。
- `App.tsx`:加一个全局 `keydown`(capture)监听:`Ctrl+Shift+B` → `toggleBroadcastInput()`(`preventDefault`)。
- 视觉:`TerminalView` 的 `terminal-pane` 在 `broadcastInput` 开时附加 `broadcasting` 类;`global.css` 加 `.terminal-pane.broadcasting { outline: 2px solid var(--accent, #3b78ff); outline-offset: -2px; }`。
- i18n:`status_broadcast`(label/tooltip)、`status_broadcast_on`/`_off` 视需要。

**A4 边界**:仅发已 `connected` 的标签;0 个其它已连接标签时为无害空操作;关闭某标签后其 sender 已在清理中删除,`sendInputToTab` 返回 false 安全跳过。

### B. 命令/连接面板

**B1 组件** `src/components/CommandPalette/CommandPalette.tsx`:
- 居中弹窗:搜索 `<input autoFocus>` + 结果列表。
- 数据源:`sessions.filter(s => !s._temporary)`(连接项)+ `tabs.filter(t => t.type !== 'asset-list')`(切换项)。
- 过滤:大小写不敏感子串,匹配会话 `name`/`host` 与标签 `title`;会话在前、标签在后(或按匹配位置简单排序)。
- 交互:`↑/↓` 移动高亮、`Enter` 执行高亮项、`Esc` 关、点击遮罩关、点击项执行。
- 执行:
  - 会话项 → 复用 `handleConnect` 等价逻辑:`tabs.find(t => t.sessionId === session.id)` 有则 `setActiveTab`,否则 `addTab({id:uuid, sessionId:session.id, title:session.name, type:session.session_type, connected:false})`;关闭面板。
  - 标签项 → `setActiveTab(tab.id)`;关闭面板。

**B2 状态**(`appStore.ts`):`showCommandPalette: boolean` + `setShowCommandPalette(show)`。

**B3 触发**:
- `App.tsx`:全局 keydown `Ctrl+Shift+F` → `setShowCommandPalette(true)`(`preventDefault`);根部懒加载 `{showCommandPalette && <CommandPalette/>}`。
- `AppMenu.tsx`:给 "Quick Search" 项加 `onClick={() => { setShowCommandPalette(true); setShowAppMenu(false); }}`。

**B4 i18n/CSS**:`palette_placeholder`、`palette_no_results`、`palette_sessions`、`palette_tabs`(分组标题,可选);`global.css` 加 `.command-palette-*` 样式(遮罩 + 卡片 + 列表项 + 高亮)。

### C. 登录脚本补全(复用 snippetExpand)

**C1 公共件** `src/lib/sendScript.ts`:
```
import { expandSnippet } from './snippetExpand';
export function runScript(send: (data: string) => void, script: string): void {
  let delay = 0;
  for (const seg of expandSnippet(script)) {
    if (seg.kind === 'delay') delay += seg.delayMs;
    else { const text = seg.text; if (delay === 0) send(text); else setTimeout(() => send(text), delay); }
  }
}
```
(从 `SnippetPanel.send` 抽出的相同调度逻辑。)

**C2 SnippetPanel 改用**(DRY):`SnippetPanel.send` 改为 `runScript((d) => sendInputToTab(activeTab.id, d), snippet.command)`(保持"无活动终端禁用/报错"判断)。

**C3 TerminalView 三处接入**:
- **SSH**(`:1339` `connectionReady=true` 之后、tunnel 块前后均可):
```
if (session.init_command) {
  setTimeout(() => runScript((d) => { invoke('write_to_ssh', { sessionId: tab.sessionId, data: d }).catch(() => {}); }, session.init_command!), 300);
}
```
- **Serial**(`serial_open` 成功后):
```
if (session.serial_init_commands) {
  setTimeout(() => runScript((d) => { invoke('write_to_serial', { sessionId: tab.sessionId, data: d }).catch(() => {}); }, session.serial_init_commands!), 300);
}
```
- **本地**(迁移 `:1308`):**保留**原 300ms `setTimeout`(等 shell 就绪),在其回调内改调 `runScript((d) => { invoke('write_to_pty', { sessionId: tab.sessionId, data: d }).catch(() => {}); }, cmd)`(即外层 300ms 仍在,内部用 runScript 处理转义/延时)。三处(SSH/serial/local)均采用"外层 300ms setTimeout 包 runScript"的统一写法。

**C4 说明**:`init_command`/`serial_init_commands` 文本可含 `\n`(换行=回车提交)、`\sNNN`(延时)、`\xNN`(控制码,如 `\x03`)。serial 多命令用换行或 `\sNNN` 分隔即可。

---

## 3. 数据流
- **广播**:聚焦终端键入 → `onData` → 写自身 `writeQueue` + (开广播时) 对每个其它已连接标签 `sendInputToTab`。
- **面板**:`Ctrl+Shift+F`/菜单 → `showCommandPalette` → 选会话/标签 → `addTab`/`setActiveTab` → 关。
- **登录脚本**:连上(SSH/serial/local)→ 若有 init → `runScript` 经 `expandSnippet` 调度 text/delay → `write_to_*` IPC。

## 4. 错误处理与边界
- 广播:仅 `connected` 标签;无回环;空目标无操作;关标签后 sender 已删,安全跳过。
- 面板:会话连接复用既有 `addTab` 路径,避免分叉;无结果显示占位;Esc/遮罩关。
- runScript 延时:标签若在脚本执行中关闭,`sendInputToTab` 返回 false / `invoke` 失败被 `.catch` 吞,无崩溃(可接受;不强求取消未决 timer)。
- 全局热键:`App.tsx` capture-phase keydown,`Ctrl+Shift+B`/`Ctrl+Shift+F` 命中即 `preventDefault`,避免下传到 xterm;不新增 xterm 监听,不碰 TerminalView "每 tab 一套监听"不变量。
- 设置双声明:本阶段不新增 `AppSettings` 字段(广播是会话态而非持久设置;若日后要记忆广播态再单列)。

## 5. 测试计划(无自动化测试框架)
**静态**:`npm run build`、`npm run smoke:check`。**无 Rust 改动,cargo 不涉及。**

**手动清单**:
1. 广播:开两个以上 SSH/本地标签并连接,StatusBar 开关亮起,在一个标签键入 → 所有已连接标签同步收到;关广播后仅当前标签收到;断开的标签不收;`Ctrl+Shift+B` 切换;广播时面板有描边。
2. 面板:`Ctrl+Shift+F`(及菜单 Quick Search)弹出;输入过滤会话与标签;Enter 连接会话(已开则聚焦)/切换标签;Esc/遮罩关;无结果占位。
3. 登录脚本:SSH 会话设 `init_command`(含 `\sNNN` 延时,如 `whoami\s500\n`)→ 连上后按序执行;serial 的 `serial_init_commands` 同理;本地 shell 迁移后仍正常,且支持转义。
4. 回归:片段面板发送(改用 runScript 后)仍正常;既有复制/粘贴/补全不受影响。

## 6. 落点文件清单
**新增**:`src/lib/sendScript.ts`、`src/components/CommandPalette/CommandPalette.tsx`。
**修改**:`src/stores/appStore.ts`(broadcastInput + toggle;showCommandPalette + setter)、`src/components/Terminal/TerminalView.tsx`(onData 广播、pane broadcasting 类、SSH/serial/local init 经 runScript)、`src/components/StatusBar/StatusBar.tsx`(广播开关)、`src/App.tsx`(全局热键 + 渲染面板)、`src/components/AppMenu/AppMenu.tsx`(Quick Search 接面板)、`src/components/Sidebar/SnippetPanel.tsx`(改用 runScript)、`src/i18n/locales/gwshell.{en,zh}.json`、`src/styles/global.css`(广播描边 + 面板样式)。

## 7. 已定默认值
1. 广播 = 所有已连接交互终端标签(分屏未实现,故面向标签);默认关;热键 `Ctrl+Shift+B`;视觉描边。
2. 面板 = 会话 + 已开标签,子串过滤;热键 `Ctrl+Shift+F` + 菜单 Quick Search。
3. 登录脚本复用 `\xNN/\sNNN`(snippetExpand);覆盖 SSH/serial/local 三类;抽 `runScript` 公共件,SnippetPanel 一并改用。
4. 本阶段不加持久化设置字段(广播是会话态)。
