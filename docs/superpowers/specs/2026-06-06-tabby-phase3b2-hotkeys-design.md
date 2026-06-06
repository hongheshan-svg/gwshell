# Phase 3b-2 设计:可配置快捷键(全局动作)

- 日期:2026-06-06 · 状态:设计(用户已总批"全做",直接进实现)· 纯前端
- 范围:把**全局 app 动作**做成可配置快捷键(keymap 注册表 + 匹配器 + dispatcher + 可编辑设置 UI),替换 Phase 3a 在 `App.tsx` 的硬编码 `Ctrl+Shift+B/F` 监听。

## 0. 范围裁剪(降风险)
探查结论:keymap 是 greenfield(无注册表/匹配器/chord),最大雷区是**终端 capture 顺序 + 复制/粘贴/ghost 回归**。故 v1 **只让全局动作可重绑**;**终端复制/粘贴/ghost/候选循环键保持硬编码、不可重绑**(TerminalView 原样不动)→ 直接排除终端回归风险。chord 的类型/解析内建,默认绑定均为单组合。

## 1. 现状
- `App.tsx` 有一个 window-capture keydown 监听(Phase 3a):`Ctrl+Shift+B`→`toggleBroadcastInput`,`Ctrl+Shift+F`→`setShowCommandPalette(true)`。本阶段**替换**它。
- 无 keymap 基础设施;`isCopy/isPasteShortcut` 在 TerminalView(终端专用,**本阶段不动**)。
- 设置持久化:`AppSettings` 扁平接口 + `normalizeSettings`(`settingsStore.ts:162`)+ `save→save_app_settings` JSON blob。SettingsModal 快捷键表是静态 `<kbd>` 卡。
- `removeTab` 拒删 asset-list;`tabs`/`activeTabId`/`setActiveTab`/`removeTab`/`setShowSettings` 在 appStore。

## 2. 设计

### A. 动作注册表 `src/keymap/actions.ts`
```ts
export interface KeyAction { id: string; labelKey: TranslationKeys; defaultBinding: string; run: () => void }
```
v1 全局动作(每个 `run` 直接读单例 store):
- `broadcast.toggle` — `Ctrl+Shift+B` — `useAppStore.getState().toggleBroadcastInput()`
- `palette.open` — `Ctrl+Shift+F` — `useAppStore.getState().setShowCommandPalette(true)`
- `tab.next` — `Ctrl+Tab` — 在非 asset-list 标签间循环到下一个
- `tab.prev` — `Ctrl+Shift+Tab` — 上一个
- `tab.close` — `Ctrl+W` — `removeTab(activeTabId)`(asset-list 自动被 removeTab 拒)
- `settings.open` — `Ctrl+,` — `setShowSettings(true)`
导出 `KEY_ACTIONS: KeyAction[]` + `ACTION_BY_ID: Map`。

### B. 匹配器 `src/keymap/match.ts`
- `Step = { ctrl:boolean; shift:boolean; alt:boolean; meta:boolean; key:string }`;`Chord = Step[]`。
- `parseBinding(s: string): Chord | null` —— 空格分步,每步 `+` 分修饰符与键;键归一化(大小写无关,特殊键名 `Tab`/`Comma`/`Backspace`/`Enter`/`F1..` 等;`,`↔`Comma`)。非法返回 null。
- `matchStep(e: KeyboardEvent, st: Step): boolean` —— 比较四个修饰符标志 + 键(`e.key` 归一化,或对特殊键用 `e.code`/`e.key` 映射)。
- `formatBinding(s)`/`eventToStep(e)`(供设置 UI 捕获按键 → 生成绑定串)。
- **不触碰** TerminalView 的 isCopy/isPasteShortcut。

### C. dispatcher `src/keymap/dispatch.ts`
- `resolveBindings(overrides: Record<string,string|null>): { actionId: string; chord: Chord }[]` —— 默认 ⊕ overrides(null=解绑跳过;非法绑定丢弃)。
- `createKeymapHandler(getOverrides: () => Record<string,string|null>): (e: KeyboardEvent) => void`:
  - `if (e.defaultPrevented) return;`
  - chord 状态:pending 前缀步 + ~1s 超时(默认单步,前缀逻辑就绪)。
  - 遍历已解析绑定:命中当前步(或完成 chord)→ `e.preventDefault(); e.stopPropagation();` → `ACTION_BY_ID.get(actionId)?.run()`。
  - 仅全局动作(v1 无终端 scope)。

### D. 持久化:`keymapOverrides`
- `AppSettings` 加 `keymapOverrides: Record<string, string | null>`(默认 `{}`)——两处 AppSettings 声明 + 默认值。
- `normalizeSettings`:遍历 overrides,丢弃未知 actionId、丢弃 `parseBinding` 失败的项。
- 随现有 `save_app_settings` JSON blob 持久化,**零后端**。

### E. App.tsx 接线
- 删除 Phase 3a 的 `Ctrl+Shift+B/F` 监听 effect。
- 新增 effect:`const handler = createKeymapHandler(() => useSettingsStore.getState().settings.keymapOverrides);` `window.addEventListener('keydown', handler, true)`;cleanup 移除;依赖 `[keymapOverrides]`(重绑后重装)。

### F. 设置 UI(SettingsModal)
- 新建/复用一个分区,列出 6 个可重绑动作为**可编辑行**:展示当前绑定(default⊕override)为可点芯片 → 点击进入"按下按键…"捕获态 → 下一个 keydown 经 `eventToStep` 归一化为绑定串 → 校验**该可重绑集合内无冲突**(冲突→内联错误,不写)→ 写 `keymapOverrides[id]` 并 `settingsStore.save`。每行一个"恢复默认"。
- 捕获态的 keydown 必须 `stopPropagation`+`preventDefault`,避免触发正在重绑的快捷键 / dispatcher。
- 旧静态目录表保留为只读参考(不改)。
- i18n:动作 label 键、`shortcut_press_key`、`shortcut_conflict`、`shortcut_reset`、`shortcut_unbind`、分区标题。

## 3. 边界/风险
- 终端键不可重绑 → 无终端回归。
- dispatcher window-capture + `defaultPrevented` 守卫 + 命中即 `preventDefault`+`stopPropagation`。
- `Ctrl+W`/`Ctrl+Tab`/`Ctrl+,` 可能撞 webview 默认 → `preventDefault` 处理;`Ctrl+W` 仅在有可关标签时生效(removeTab 拒 asset-list)。
- 重绑捕获吞自身按键(stopPropagation)。
- 不新增 xterm/终端监听,不碰 TerminalView 不变量。
- 冲突仅在可重绑集合内检测(拒绝+内联错误,last-write 不静默覆盖)。

## 4. 测试
tsc + build + smoke;手动:改某动作绑定→生效且持久(重启后保留);解绑→失效;恢复默认;冲突拒绝;终端复制/粘贴/ghost/广播/面板不受影响。纯前端,无 Rust。

## 5. 落点
**新增**:`src/keymap/actions.ts`、`match.ts`、`dispatch.ts`;可能 `src/components/Settings/ShortcutEditor.tsx`(可编辑行)。
**修改**:`src/App.tsx`(替换监听)、`src/stores/settingsStore.ts`(keymapOverrides + normalize,两处 AppSettings)、`src/components/Settings/SettingsModal.tsx`(可编辑分区 + 两处 AppSettings)、`src/i18n/locales/gwshell.{en,zh}.json`、`src/styles/global.css`。

## 6. 已定默认
全局 6 动作可重绑;终端键不可重绑(v1);`keymapOverrides` 存 AppSettings blob;冲突拒绝;chord 内建但默认单组合。
