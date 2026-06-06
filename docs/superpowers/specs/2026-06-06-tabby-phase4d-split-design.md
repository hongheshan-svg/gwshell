# Phase 4d 设计:2-pane 分屏(保守,opt-in)

- 2026-06-06 · 纯前端 · **tsc 验;渲染/fit 行为不可在此验证(用户目测)**
- 范围裁剪:分屏目前**根本不存在**(TerminalContainer 渲染所有标签、仅活动可见)。从零做完整嵌套树太大且盲做高风险 → v1 只做**最小可用的 2-pane 并排分屏**,且 **split 关闭(默认)路径与现状逐字节一致**(把核心终端区回归风险降到最低)。这也顺带让 CLAUDE.md 的"分屏"描述部分成真。

## 关键安全属性
- **默认 split 关闭时,行为与当前完全一致**(TerminalContainer 仍渲染所有标签、仅 activeTabId 可见)。分屏是纯增量、opt-in。
- 守住 TerminalView "每 tab 一套监听"不变量:仍是每标签一个 TerminalView 实例;分屏只是让**两个**标签同时可见(display 控制),不新增/复制监听。
- 已知局限(标注):分屏下 ghost 文本定位以 `.terminal-container` 为基准(P1 既有限制);两个面板左右顺序按标签索引。

## 设计
1. **appStore**:`splitTabId: string | null`(默认 null=不分屏)+ `setSplitTabId(id|null)`。`removeTab`/切换时若 splitTabId 指向已关标签则置 null(清理)。
2. **TerminalContainer**:
   - `splitTabId == null` → **原样**(当前代码不动)。
   - `splitTabId != null` 且该标签存在且 != activeTabId → 给容器加 `terminal-split-grid` 类(2 列网格);给每个 `<TerminalView>` 传 `visible`(= `tab.id===activeTabId || tab.id===splitTabId`)。其余标签 `visible=false`(display:none,不占网格格)。
3. **TerminalView**:新增可选 `visible?: boolean` prop。pane 的 `display` 改为 `(visible ?? isActive) ? 'block' : 'none'`(不传 visible 时退化为现状 isActive,默认路径不变)。在 pane 上加 `onMouseDown` → `setActiveTab(tab.id)`(点面板即聚焦)。**fit**:依赖既有 ResizeObserver——切换分屏使面板尺寸变化→observer 触发既有 fit;无需新 fit 逻辑(确认 observer 在 display 变化后能拿到非零尺寸;若 display:none→block 后 observer 已 fire 则 OK)。
4. **UI(TabBar)**:一个分屏切换按钮(图标如 `Columns`)。点开:`setSplitTabId(<上一个活动的终端标签 或 下一个非活动连接标签>)`;再点关:`setSplitTabId(null)`。仅当存在 ≥2 个终端标签时显示。
5. **CSS**:扩展既有孤儿类 `.terminal-container.terminal-split-grid { grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border-color); }`(已是 `display:grid`)。

## 边界
- splitTabId 指向的标签关闭/不存在 → 视为不分屏(回退单面板)。
- 不做 4/6/8 网格、不做嵌套树、不做拖拽(v1)。
- 默认路径零改动 → 不分屏用户无感、无回归。
- 不动终端键/写/onData/广播逻辑。

## 测试
tsc + build + smoke。运行时(用户):开分屏→两个终端并排、都可交互、各自 fit;点面板切活动;关分屏→回单面板;关掉其中一个面板的标签→回退。默认(不分屏)行为不变。

## 落点
改 `appStore.ts`(splitTabId+setter+removeTab 清理)、`TerminalContainer.tsx`(分屏渲染+visible 传递)、`TerminalView.tsx`(visible prop + pane onMouseDown)、`TabBar.tsx`(分屏按钮)、`global.css`、i18n(`split_toggle`)。
