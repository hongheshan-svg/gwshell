# 合并 Tabby 可借鉴功能 · Phase 2 设计:终端交互增强

- 日期:2026-06-06
- 状态:已批准设计,待写实现计划
- 范围:Phase 2 = 粘贴安全 + Quick Connect + 主题预设(Tier A 余下的无依赖子集)
- 前置:Phase 1 已合并到 main(命令补全打磨 + 片段库)

---

## 0. 背景与范围裁剪

路线图 Phase 2 原列 Tier A 五项。调研发现两项受环境/架构限制:

- **终端内搜索** 需 `@xterm/addon-search`(未安装),本会话 `npm install` 被环境安全分类器拦截 → **推迟**。
- **字体连字** 的 `ligatures` 设置已存在但**从未接到 xterm**(当前是 no-op);且 `@xterm/addon-ligatures` 只支持 xterm 的 **DOM 渲染器**,而 gwshell 跑的是 **webgl/canvas** 渲染器 → 根本不兼容 → **推迟**(单列处理,可能需要渲染器层改动)。

经确认,Phase 2 聚焦三项**纯前端、无新依赖、无 Rust 改动**的特性。搜索与连字另案后续。

---

## 1. 现状(已在源码核实)

- **粘贴/复制**:`src/components/Terminal/TerminalView.tsx` 已有完整处理 —— `doPaste`(`:527`,`readClipboardText().then(t => termRef.paste(t))`)、`doCopy`、`isPasteShortcut`、中键/右键粘贴动作(`middleClickAction`/`rightClickAction`)、右键菜单。无多行粘贴确认。
- **xterm 主题**:`getTerminalThemeColors(theme: ThemeMode)`(`:36-90`)按 app 明/暗返回一个 ITheme 对象(background/foreground/cursor/selection + 16 ANSI 色 + scrollbar 三色)。创建时 `theme: getTerminalThemeColors(...)`(`:459`),app 主题变更时 `inst.terminal.options.theme = getTerminalThemeColors(theme)`(`:1461`)。
- **设置实时生效**:`src/hooks/useSettingsEffects.ts` 是统一的"设置→终端实时更新"入口,已有一个遍历 `terminalInstances`(来自 `terminalRegistry`)更新字体/字号/行高/letterSpacing/scrollback 的 effect(`:59-84`)。主题预设的实时套用接在这里最自然。
- **会话/标签/连接**:`SessionPanel.handleConnect`(`:64-78`)只做 `addTab({id, sessionId, title, type, connected:false})`;真正连接发生在 `TerminalView` 的 effect 里(它用 `sessionsRef.current.find(s => s.id === tab.sessionId)` 取会话配置构造 SSH 参数)。**因此被连接的会话必须先存在于 store 的 `sessions` 数组**。
- **会话持久化**:`appStore.addSession`(`:117-128`)**总是**调 `invoke('save_session')` 持久化,**不区分 `_temporary`**。`removeTab`(`:171-189`)在标签关闭时会清理 `_temporary` 且无其它标签引用的会话。
- **Modal 标志模式**:`showNewSession`/`setShowNewSession`(`:217-218`)等;App.tsx 在根部懒加载渲染各 modal。IconNav 的 `quickconnect` 项当前 `case 'quickconnect': setShowNewSession(true)`。
- **设置双声明**:`AppSettings` 接口与 `defaultSettings` 在 `settingsStore.ts` 与 `SettingsModal.tsx` 各声明一份,新增设置须同时改两处(否则构建失败/弹窗失配)。设置行组件:`Row`/`Toggle`/`Sel`/`NumInput`,更新器 `u(key, v)`。
- **i18n**:`src/i18n/locales/gwshell.{en,zh}.json`,扁平键,en 驱动 `TranslationKeys` 类型。
- **auth 枚举**:`SessionConfig.auth_method: 'password' | 'publickey' | 'keyboardinteractive' | 'agent' | 'none'`(`src/types/index.ts`)。
- **Tauri 约定**:JS `invoke` 传 camelCase,Rust 收 snake_case(自动转换)。本阶段无新 IPC。

---

## 2. Phase 2 设计

### A. 粘贴安全(多行确认)

**A1 设置**:新增 `pasteWarnMultiline: boolean`(默认 `true`)到**两处** `AppSettings` + 两处 `defaultSettings`;SettingsModal 在 SSH/SFTP 区(粘贴相关设置附近)加一行 `<Row><Toggle .../></Row>`;i18n 加 `settings_paste_warn_multiline`。

**A2 拦截 doPaste**(`TerminalView.tsx`):`doPaste` 改为读剪贴板后判断:
```
if (settings.pasteWarnMultiline && text.includes('\n')) → setPasteConfirm(text)
else → termRef.paste(text)
```
新增组件 state `const [pasteConfirm, setPasteConfirm] = useState<string | null>(null)`。

**A3 确认浮层**(TerminalView 返回的 JSX,`pasteConfirm !== null && isActive` 时渲染):
- 显示总行数,以及内容预览(前 8 行,超出省略,等宽、`white-space: pre`、可滚动)。
- 两个按钮:粘贴 / 取消。粘贴 → `terminalInstances.get(tab.id)?.terminal.paste(pasteConfirm); setPasteConfirm(null)`;取消 → `setPasteConfirm(null)`。
- 键盘:Enter 确认、Esc 取消(浮层级 keydown,不影响终端单监听不变量——纯 React state/JSX,不新增 xterm 监听)。
- i18n:`paste_confirm_title`、`paste_confirm_lines`(带行数插值)、`paste_confirm_paste`、`paste_confirm_cancel`。
- CSS:`global.css` 加浮层样式(覆盖在 pane 上,居中卡片)。

**边界**:右键/中键粘贴动作(`doPaste`)同样走此拦截(它们都调 `doPaste`)。空剪贴板/无换行直接粘贴,行为不变。

### B. Quick Connect(独立轻量条)

**B1 解析器** `src/lib/quickConnect.ts`:
```
export interface QuickTarget { username?: string; host: string; port: number }
export function parseQuickConnect(input: string): QuickTarget | null
```
- 文法 `[user@]host[:port]`:trim;按最后一个 `@` 分 user/rest(无 `@` 则无 user);rest 按最后一个 `:` 分 host/port(端口须为 1-65535 的数字,否则视为 host 的一部分→无端口);host 去空后必须非空,否则返回 null;port 默认 22。
- 仅处理 SSH 目标(Phase 2 不解析 serial `port@baud` 等)。

**B2 store**(`appStore.ts`):
- 加 modal 标志 `showQuickConnect: boolean` + `setShowQuickConnect(show)`(镜像 `showNewSession` 模式)。
- 加动作 `addTemporarySession(session: SessionConfig)`:`set(state => ({ sessions: [...state.sessions, session] }))` —— **仅内存,不调 `save_session`**(区别于会持久化的 `addSession`)。

**B3 Modal** `src/components/Modals/QuickConnectModal.tsx`:
- 一个文本输入(占位 `user@host:port`,自动聚焦)+ 一个可选密码输入(`type=password`)+ 连接/取消按钮。
- 提交:`parseQuickConnect(input)`;为 null → 内联错误 `quickconnect_invalid`;否则构造:
```
const id = crypto.randomUUID();
const cfg: SessionConfig = {
  id, name: input.trim(), session_type: 'ssh',
  host: t.host, port: t.port, username: t.username,
  auth_method: password ? 'password' : 'agent',
  password: password || undefined,
  _temporary: true,
};
addTemporarySession(cfg);
addTab({ id: crypto.randomUUID(), sessionId: id, title: t.username ? `${t.username}@${t.host}` : t.host, type: 'ssh', connected: false });
setShowQuickConnect(false);
```
- i18n:`quickconnect_title`、`quickconnect_placeholder`、`quickconnect_password`、`quickconnect_connect`、`quickconnect_cancel`、`quickconnect_invalid`。

**B4 接线**:
- `IconNav.tsx`:`case 'quickconnect': setShowQuickConnect(true)`(从 `setShowNewSession(true)` 改;`setShowQuickConnect` 加入 useAppStore 解构)。
- `App.tsx`:懒加载 `const QuickConnectModal = lazy(() => import('./components/Modals/QuickConnectModal')...)`,在根部 `{showQuickConnect && <QuickConnectModal/>}`(加 `showQuickConnect` 到 useAppStore 解构)。

**说明**:Quick Connect 会话不入库;关闭其标签时 `removeTab` 既有 `_temporary` 清理逻辑会移除该内存会话。auth 设计:有密码用 `password`,无密码用 `agent`(免密/SSH agent),key 用户走 agent。

### C. 主题预设

**C1 主题库** `src/lib/terminalThemes.ts`:
- `export const TERMINAL_THEMES: Record<string, ITheme>`,含 6 套:`campbell`、`onedark`、`dracula`、`solarized-dark`、`solarized-light`、`nord`。每套是与 `getTerminalThemeColors` 同字段的完整 ITheme(background/foreground/cursor/cursorAccent/selectionBackground + 16 ANSI + 3 scrollbar 色),取各方案的标准配色。
- `export function resolveTerminalTheme(scheme: string, appTheme: ThemeMode): ITheme`:`scheme === 'auto'` → 现有明/暗默认;命中预设 → 返回之;未知 → 回退 auto。**明确**:把 `TerminalView.tsx` 里现有 `getTerminalThemeColors` 的两套明/暗配色**整体迁入本文件**作为 `'auto'` 分支的实现(本文件成为唯一来源),`TerminalView` 删除其本地 `getTerminalThemeColors`,改 `import { resolveTerminalTheme }`。
- 导出 `export const TERMINAL_SCHEME_OPTIONS: string[]`(`['auto', ...6]`)供设置下拉与校验。

**C2 设置**:新增 `terminalColorScheme: string`(默认 `'auto'`)到两处 AppSettings + 两处 defaultSettings;SettingsModal 加一行 `<Row><Sel options={...} .../></Row>`(选项为 Auto + 6 个方案名,展示名走 i18n 或直接用方案名);i18n 加 `settings_terminal_color_scheme`(+ 可选各方案展示名键)。

**C3 套用**:
- `TerminalView.tsx`:创建处(`:459`)与 app 主题变更处(`:1461`)由 `getTerminalThemeColors(theme)` 改为 `resolveTerminalTheme(useSettingsStore.getState().settings.terminalColorScheme, theme)`。
- `useSettingsEffects.ts`:新增一个 effect,依赖 `[settings.terminalColorScheme, settings.theme]`,遍历 `terminalInstances` 设 `terminal.options.theme = resolveTerminalTheme(settings.terminalColorScheme, settings.theme)`,并 `requestAnimationFrame` 里 `terminal.refresh(0, rows-1)`(参考既有字体 effect 的刷新方式)。
- 保留/迁移:`getTerminalThemeColors` 的两套明/暗配色作为 `'auto'` 的实现,集中到 `terminalThemes.ts`,TerminalView 不再各自硬编码(减少重复)。

---

## 3. 数据流
- **粘贴**:右键/中键/Ctrl-V → `doPaste` → 读剪贴板 → 含换行且开关开 → `setPasteConfirm` → 浮层确认 → `terminal.paste`。否则直接 paste。
- **Quick Connect**:IconNav → `setShowQuickConnect(true)` → Modal 提交 → `parseQuickConnect` → `addTemporarySession` + `addTab` → TerminalView 取内存会话连接。
- **主题**:设置改 `terminalColorScheme` → settingsStore 保存 → `useSettingsEffects` effect → 遍历 `terminalInstances` 套用 `resolveTerminalTheme` → refresh。

## 4. 错误处理与边界
- 解析失败 → Modal 内联报错,不创建会话/标签。
- 空剪贴板 → 不弹确认、不粘贴。
- 未知 `terminalColorScheme`(如旧配置或手改)→ `resolveTerminalTheme` 回退 `'auto'`。
- 设置双声明:`pasteWarnMultiline`、`terminalColorScheme` 必须同时加到 `settingsStore.ts` 与 `SettingsModal.tsx` 两份 `AppSettings`/`defaultSettings`。
- 不新增任何 xterm 事件监听(粘贴浮层是 React state/JSX),不触碰 TerminalView 的"每 tab 一套监听"不变量。
- Quick Connect 临时会话:不持久化;关闭标签由既有 `_temporary` 清理回收。

## 5. 测试计划(无自动化测试框架)
**静态**:`npm run build`(tsc + Vite)、`npm run smoke:check`。**无 Rust 改动,cargo 不涉及。**

**手动清单**:
1. 多行粘贴(右键/中键/Ctrl-V 各一次)→ 弹确认,预览正确;粘贴执行、取消不执行;Esc 取消。单行/空剪贴板不弹。关掉 `pasteWarnMultiline` 后多行直接粘贴。
2. Quick Connect:`user@host:port`、`host`、`host:port`、`user@host` 各能解析;非法输入(空 host)内联报错;连接后是临时会话(不出现在会话列表/重启后消失);关标签后内存会话被清理。带密码走 password、不带走 agent。
3. 主题预设:切到各预设,**所有打开的终端实时变色**;切回 Auto 跟随 app 明/暗;未知值回退 auto。
4. 回归:既有复制/粘贴快捷键、右键菜单、分屏不受影响。

## 6. 落点文件清单
**新增**:`src/lib/quickConnect.ts`、`src/components/Modals/QuickConnectModal.tsx`、`src/lib/terminalThemes.ts`。
**修改**:`src/components/Terminal/TerminalView.tsx`(粘贴拦截+浮层、主题改用 resolveTerminalTheme)、`src/hooks/useSettingsEffects.ts`(主题 effect)、`src/stores/appStore.ts`(showQuickConnect + addTemporarySession)、`src/stores/settingsStore.ts`(2 设置)、`src/components/Settings/SettingsModal.tsx`(2 设置的双声明 + 行)、`src/components/Sidebar/IconNav.tsx`(quickconnect 指向)、`src/App.tsx`(渲染 modal)、`src/i18n/locales/gwshell.{en,zh}.json`、`src/styles/global.css`(粘贴浮层 + quick-connect modal 样式)。

## 7. 已定默认值
1. Quick Connect auth:有密码→`password`,无→`agent`。
2. 粘贴确认:含 `\n` 即触发,`pasteWarnMultiline` 默认 true 可关。
3. 主题预设独立于 app 明/暗;`terminalColorScheme` 默认 `'auto'`(沿用当前行为)。
4. 搜索、连字本阶段推迟(搜索待 npm 依赖;连字待渲染器评估)。
