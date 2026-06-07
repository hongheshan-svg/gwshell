# P3 · 命令优先导航（Command-First Nav）设计

**日期:** 2026-06-07
**状态:** 待用户确认
**所属:** GWShell UI 现代化，子项目 3 / 4（依赖 P1 令牌；与 P2 并存于同分支）

---

## 1. 背景与目标

当前 `CommandPalette`（仅 77 行）只能模糊搜索**会话 + 已开标签**并跳转，触发键是 Ctrl+Shift+F，**没有暴露任何"命令/动作"**。侧栏是唯一主导航。

P3 把命令面板升级为 **⌘K 命令中枢**（Raycast/VSCode 气质）：一个入口即可搜索会话、切换标签、执行所有 app 动作、发起创建/导航。侧栏轻度降级（不删除）。

---

## 2. 已锁定决策

| 决策 | 结论 |
|---|---|
| 命令范围 | ② 丰富：会话(连接) + 标签(切换) + keymap 动作 + 创建/导航命令 |
| 触发键 | `palette.open` 重绑为 **⌘K（mac: Meta+K / 其他: Ctrl+K）**，按平台；不保留 Ctrl+Shift+F 旧别名（保持单绑定干净） |
| 侧栏降级 | 轻度：titlebar 中央放显眼「⌘K 命令入口」药丸；侧栏保留、仍可折叠，不强制隐藏 |

---

## 3. 命令模型

新增 `src/components/CommandPalette/commands.ts`，导出 `buildCommands(ctx): Command[]`。

```ts
export interface Command {
  id: string;
  group: 'action' | 'create' | 'session' | 'tab';
  label: string;
  sub?: string;        // host / type / description
  hint?: string;       // formatted keybinding, e.g. "⌘,"
  keywords?: string;   // extra fuzzy-match text
  icon?: LucideIcon;
  run: () => void;
}
```

命令来源：
1. **keymap 动作**（`KEY_ACTIONS`，排除 `palette.open` 自身）：`group:'action'`，`label = t(action.labelKey)`，`hint = formatBinding(effectiveBinding)`，`run = action.run`。绑定取用户覆盖 `settings.keymapOverrides[id] ?? action.defaultBinding`，用 `formatStep`/已有格式化工具显示。
2. **创建/导航命令**（静态，`group:'create'`）：新建 SSH、新建本地终端、快速连接、打开主页（`setActiveTab('asset-list')`）、切换主题（dark↔light）、切换侧栏（`toggleSidebar`）、打开设置。调用对应 store / 既有触发（复用 `NewAssetMenu` 的打开逻辑：`setShowNewSession`/`setShowQuickConnect`/`setShowLocalTerminal` 等——实现时读 NewAssetMenu 确认方法）。
3. **会话**（`group:'session'`）：非 `_temporary` 会话 → 连接（复用现有：找已存在标签则切换，否则 `addTab`）。
4. **标签**（`group:'tab'`）：非 `asset-list` 的已开标签 → `setActiveTab`。

`buildCommands` 入参 `ctx` 提供所需 store 方法/数据（sessions、tabs、各 setter、theme、setTheme），在组件内用 `useAppStore`/`useSettingsStore` 取并 `useMemo` 构建。

---

## 4. CommandPalette 重写

`src/components/CommandPalette/CommandPalette.tsx`：
- 顶部输入框（已有 `.command-palette-input`）+ 分组列表（已有 `.command-palette-*` 样式，P1 已玻璃化）。
- **分组渲染**：按 group 顺序（建议：匹配时 动作/创建 在前，会话、标签随后）；每组一个小标题（`命令` / `创建` / `会话` / `标签`）。空查询时也展示（动作+创建+会话+最近标签）。
- **模糊过滤**：跨 `label + sub + keywords`，大小写不敏感（沿用现有 includes；可选轻量打分排序）。
- **键盘**：↑/↓ 移动、Enter 执行、Esc 关闭、输入即过滤；选中项 `scrollIntoView`。鼠标 hover 高亮、点击执行。
- 每项右侧显示 `hint`（快捷键）与图标。
- 执行后 `setShowCommandPalette(false)`。

保持现有 overlay/card 类名以复用 P1 玻璃样式；视觉增强（图标列、分组标题、hint chip）在 `global.css` 的 `.command-palette-*` 区补充，全用令牌。

---

## 5. 触发键（⌘K，按平台）

`src/keymap/actions.ts`：把 `palette.open` 的 `defaultBinding` 改为按平台：
```ts
import { IS_MACOS } from '<同 TitleBar 的来源>';
...
{ id: 'palette.open', labelKey: 'action_palette_open',
  defaultBinding: IS_MACOS ? 'Meta+K' : 'Ctrl+K',
  run: () => useAppStore.getState().setShowCommandPalette(true) },
```
（keymap 匹配严格区分 ctrl/meta，故必须按平台给绑定。`parseBinding` 已支持 `Meta+`。）实现时定位 `IS_MACOS` 的实际模块（TitleBar.tsx 已引用），复用之。

> 注：用户若已在 `keymapOverrides` 自定义过 `palette.open`，沿用其覆盖（不动）。

---

## 6. Titlebar ⌘K 命令入口药丸

`src/components/TitleBar/TitleBar.tsx`：把当前空的 `.titlebar-center` 放一个可点击药丸：
```tsx
<div className="titlebar-center" data-tauri-drag-region>
  <button className="titlebar-cmdk" onClick={() => setShowCommandPalette(true)}>
    <Search size={12} /> {t('palette_entry')} <kbd>{IS_MACOS ? '⌘K' : 'Ctrl K'}</kbd>
  </button>
</div>
```
- 药丸需 `-webkit-app-region: no-drag`（否则被拖拽区吞点击）。
- 样式 `.titlebar-cmdk`（`global.css`，令牌）：`--bg-tertiary` 底、`--border-color` 边、`--radius-md`、`--text-secondary`，hover 提亮；宽度适中居中；`kbd` 用 `--bg-secondary` 小角标。

---

## 7. 影响文件

| 文件 | 改动 |
|---|---|
| `src/components/CommandPalette/commands.ts` | 新增：`buildCommands`/`Command` 类型 |
| `src/components/CommandPalette/CommandPalette.tsx` | 重写：分组、过滤、键盘、图标、hint |
| `src/keymap/actions.ts` | `palette.open` 重绑 ⌘K（按平台） |
| `src/components/TitleBar/TitleBar.tsx` | 中央 ⌘K 药丸入口 |
| `src/styles/global.css` | `.command-palette-*` 增强 + `.titlebar-cmdk` |
| `src/i18n/locales/gwshell.{en,zh}.json` | 分组标题、创建命令标签、`palette_entry` |

---

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| ⌘K 与系统/webview 默认冲突 | webview 内 ⌘K 无系统占用；in-app keydown 优先；按平台绑定避免误触 |
| 创建命令触发逻辑与 NewAssetMenu 重复 | 读 NewAssetMenu 复用同一 store 触发方法，不另写打开逻辑 |
| 命令过多致面板嘈杂 | 空查询时分组展示、动作/创建在前；输入即过滤收敛 |
| 拖拽区吞掉药丸点击 | `.titlebar-cmdk` 显式 `app-region: no-drag` |
| keymap 单绑定无法保留旧 Ctrl+Shift+F | 已决定放弃旧别名；如需可后续加 |

---

## 9. 验证

1. `npm run build` + `npm run smoke:check` 通过。
2. 浏览器桩（[[preview-tauri-app-in-browser]]）截图：⌘K（或点药丸）打开面板；空查询显示分组（命令/创建/会话/标签）；输入过滤；方向键+回车执行；执行"切换主题/打开设置/新建 SSH"等可见效果。
3. 真应用：⌘K 打开、连接会话、切标签、跑动作；titlebar 药丸点击打开。

---

## 10. 不在 P3 范围

- 终端 Block 化（P4）。
- 真·OS vibrancy（P-future）。
- 命令的"最近/高频"智能排序（v1 用固定分组顺序；可后续）。
- 删除/重构侧栏（仅降级，不删）。
