# 合并 Tabby 可借鉴功能 · Phase 3b-1 设计:会话/标签重启恢复

- 日期:2026-06-06
- 状态:已批准设计,待写实现计划
- 范围:Phase 3b-1 = 重启后恢复打开的终端标签并自动重连(纯前端)
- 前置:Phase 1/2/3a 已合并到 main
- 后续:Phase 3b-2 = 配置快捷键(greenfield,单独 spec)

---

## 0. 背景与决策

Phase 3b(Tier B)拆为两个独立 spec:**3b-1 恢复(本文,先做,小而低风险)** 与 3b-2 配置快捷键(greenfield 高风险,后做)。探查确认:
- `sessionTabMemory` 设置**已存在但是死开关**(`settingsStore.ts` 有字段+默认 false,`SettingsModal.tsx` 有 Row,**无人读**)。本阶段接上它,不加新开关。
- 标签**纯内存、无持久化**;启动序列(`App.tsx`)无恢复步骤。
- 任一标签挂载时 `TerminalView.setupConnection` 即自动连接(读 `sessions` 里的 `SessionConfig`),所以恢复**自动重连零新代码**。
- Quick Connect 的 `_temporary` 会话**从不持久化**(`addTemporarySession` 不存盘),恢复时其会话已不存在 → 必须跳过。
- CLAUDE.md 的分屏架构不存在(标签模型),恢复无需处理多面板。

**已定默认**:全部自动重连;**localStorage** 存储(纯前端、零 IPC/后端、把瞬时标签态与用户设置/导出分离);复用 `sessionTabMemory` 门控;跳过临时/失效会话标签;恢复活动标签焦点。

---

## 1. 现状(已在源码核实)

- **TabInfo**:`{ id, sessionId, title, type, connected }`(`types/index.ts`)。`type` 含 `'asset-list'`。
- **appStore**:初始 `tabs = [ 单个 asset-list 标签 ]`(`:163`);`addTab(tab)` 追加并设为活动 + `mainView='terminal'`(asset-list 除外);`removeTab` 拒删 asset-list,且有 `_temporary` 会话 GC;`setActiveTab`;`updateTabConnected(id, connected)`。
- **会话**:`addSession` 持久化(`save_session`);`addTemporarySession`(Quick Connect)仅内存不持久化;`sessions` 数组初值来自同步注入 `popInjectedSessions()`(window.`__GWSHELL_SESSIONS__`)。
- **App.tsx 启动**(`:38-110`):`useSettingsEffects()`;`settingsLoaded = useSettingsStore(s => s.loaded)`(`:47`);加载设置 effect(`:62-64`);splash(`:80-100`);**sessions 兜底** effect(`:104-110`):`if (sessions.length === 0) get_sessions().then(setSessions)`。注入存在时 `sessions` 在首次渲染即就绪;注入缺失时走异步兜底。
- **连接生命周期**:`TerminalView` effect(key 含 `tab.id`/`tab.sessionId`/`tab.type`)挂载即 `setupConnection`(`create_local_shell`/`ssh_connect`/`serial_open`,按 `sessionId` 取 `SessionConfig`)。无"已开但未连"状态。
- **`sessionTabMemory`**:`settingsStore.ts`(字段+默认 false)、`SettingsModal.tsx`(Basic 区一个 Row)——目前无任何读取处。
- **localStorage**:Tauri webview 持久化,可跨重启;同步 API。

---

## 2. Phase 3b-1 设计

### A. 持久化模块 `src/lib/tabSession.ts`

```ts
import type { TabInfo, SessionConfig } from '../types';

export interface PersistedTab { sessionId: string; type: TabInfo['type']; title: string }
interface StoredTabs { tabs: PersistedTab[]; activeTabIndex: number }

const KEY = 'gwshell.openTabs';

// Serialize the restorable open tabs (excludes asset-list, _temporary sessions,
// and tabs whose session no longer exists). Never stores `connected`.
export function saveOpenTabs(tabs: TabInfo[], sessions: SessionConfig[], activeTabId: string | null): void {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const restorable = tabs.filter((t) => {
    if (t.type === 'asset-list') return false;
    const s = byId.get(t.sessionId);
    return !!s && !s._temporary;
  });
  const persisted: PersistedTab[] = restorable.map((t) => ({ sessionId: t.sessionId, type: t.type, title: t.title }));
  const activeTabIndex = Math.max(0, restorable.findIndex((t) => t.id === activeTabId));
  try {
    localStorage.setItem(KEY, JSON.stringify({ tabs: persisted, activeTabIndex } satisfies StoredTabs));
  } catch { /* quota / disabled — ignore */ }
}

export function loadOpenTabs(): StoredTabs | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTabs;
    if (!parsed || !Array.isArray(parsed.tabs)) return null;
    return parsed;
  } catch { return null; }
}
```

- 存储键 `gwshell.openTabs`;形状 `{ tabs: PersistedTab[], activeTabIndex }`。
- **不存** `connected`、不存 asset-list、不存 `_temporary` 会话标签、不存已删会话标签;标签 `id` 不存(恢复时新生成)。

### B. 持久化触发(`App.tsx`)

新增一个**防抖**(~500ms)effect:
- 依赖:`tabs`、`activeTabId`、`sessions`、`settingsLoaded`、`settings.sessionTabMemory`。
- 仅当 `settingsLoaded && sessionTabMemory` 时写;计算一个**派生签名**(可恢复标签的 `sessionId|type|title` 串接 + activeTabId),仅当签名相对上次变化时才 `saveOpenTabs`(避免 `updateTabConnected` 只改 `connected` 时无谓重写;也天然避免每键写盘)。
- 实现:用 `useRef` 存上次签名 + 一个 `setTimeout` 防抖(组件级,cleanup 清 timer)。
- `sessionTabMemory` 关时不写(保留既有 localStorage 不动;恢复反正被门控)。

### C. 启动恢复(`App.tsx`)

新增一个**只跑一次**的 effect:
- 依赖:`[settingsLoaded, sessions]`;用 `useRef(false)` 守卫只执行一次主体。
- 门控:`settingsLoaded === true`。读取此刻 `useAppStore.getState().sessions`(注入存在时已就绪;为覆盖异步兜底,effect 依赖 `sessions`,在其由空变非空时仍可触发,但主体 ran-once 守卫保证只执行一次)。
- 若 `!sessionTabMemory` → 标记已执行并 return(不恢复)。
- `loadOpenTabs()`;对每个 `PersistedTab`:
  - `const s = sessions.find(x => x.id === pt.sessionId)`;若无 `s` 或 `s._temporary` → 跳过(会话已删/临时)。
  - `addTab({ id: crypto.randomUUID(), sessionId: pt.sessionId, title: pt.title, type: pt.type, connected: false })`。
- 全部加完后:若 `activeTabIndex` 落在成功恢复的标签范围内,`setActiveTab(恢复出的第 activeTabIndex 个标签的新 id)`(记录每个成功 addTab 的新 id 以便定位)。
- **自动重连**:每个恢复标签由 `TerminalView` 挂载自动 `setupConnection`,无需额外代码;无休眠态。

> 时序说明:恢复发生在 splash(2s)期间,标签在揭幕时已就位。`addTab` 会把 `mainView` 切到 `'terminal'`,与"恢复到终端视图"预期一致。

### D. 门控:接上 `sessionTabMemory`
- 不新增设置字段;`settingsStore` 字段 + `SettingsModal` 的 Row 已存在。B/C 两处读 `useSettingsStore.getState().settings.sessionTabMemory`(或经 `useSettingsEffects`/props)。关→不存不恢复;开→存且恢复。

---

## 3. 数据流
- **存**:标签集变化(增/删/切活动)→ 防抖 → 派生签名变化 → `saveOpenTabs` → localStorage。
- **恢复**:启动 settings+sessions 就绪 → ran-once effect →(开关开)→ `loadOpenTabs` → 逐条校验 → `addTab` → 设活动 → 各标签 `setupConnection` 自动连。

## 4. 错误处理与边界
- 跳过 `_temporary`/已删会话标签(序列化与恢复两端双重过滤)。
- 不存/不恢复 asset-list;不存 `connected`(恢复 false,setupConnection 设活态)。
- localStorage 读写包 try/catch(配额/禁用时静默)。
- ran-once 守卫防重复恢复;空 `loadOpenTabs` 为无操作。
- 关开关:不存不恢复;不主动清除既有 localStorage(无害)。
- 不触碰 TerminalView 监听不变量(本阶段不加任何 xterm/键盘监听,仅操作 store)。

## 5. 测试计划(无自动化测试框架)
**静态**:`npm run build`、`npm run smoke:check`。**无 Rust 改动,cargo 不涉及。**

**手动清单**:
1. 设置开 `sessionTabMemory`;打开 2-3 个保存会话的标签 + 1 个本地 shell;重启 app → 标签恢复,且各自自动重连;活动标签为上次活动者。
2. 临时会话:用 Quick Connect 开一个临时标签;重启 → 该标签**不**恢复(其它正常)。
3. 删除会话:开该会话标签 → 删掉会话 → 重启 → 该标签被跳过。
4. 开关关:重启 → 不恢复(仅 asset-list)。
5. 回归:正常开/关标签、切换、Quick Connect、广播、命令面板、补全均不受影响;首屏 asset-list 行为正常。

## 6. 落点文件清单
**新增**:`src/lib/tabSession.ts`。
**修改**:`src/App.tsx`(持久化 effect + 恢复 effect;读 `sessionTabMemory`)。
(可能需要 `settingsStore` 暴露/读取 `sessionTabMemory` — 字段已存在,直接 `useSettingsStore` 读即可,无新增字段。)

## 7. 已定默认值
1. 全部自动重连(无休眠态)。
2. localStorage 存储(键 `gwshell.openTabs`),非 AppSettings blob。
3. 复用 `sessionTabMemory` 门控,不加新开关。
4. 跳过 `_temporary` 与失效会话标签;恢复上次活动标签焦点;标签 id 重新生成;不存 `connected`。
