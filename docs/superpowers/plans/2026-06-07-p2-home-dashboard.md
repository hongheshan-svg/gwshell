# P2 主页仪表盘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把主页（`asset-list`）升级为二合一卡片仪表盘——所有保存主机按分组成卡片墙，已连接 SSH 卡实时显示 CPU/内存/磁盘/负载/网络，未连接显示 ping+快连；「卡片/列表」可切换、默认卡片、表格保留。

**Architecture:** 后端给指标快照加磁盘（`df`）并给 `MetricsManager` 加引用计数以支持多卡并发取指标；前端抽 `useAssetData` 共享数据，新增 `AssetDashboard`（分组网格）+ `HostDashCard`（连接/未连接两态），实时指标复用 `server-metrics-{id}` 事件。全部走 P1 的 theme.css 令牌。

**Tech Stack:** Tauri 2 (Rust: portable metrics via SSH exec) + React/TS + Zustand + xterm（无关）。

**测试现实:** 无自动化测试。每 task 验收 = `cargo build`（后端任务）/ `npm run build` + `npm run smoke:check` + 浏览器桩截图（见 [[preview-tauri-app-in-browser]]）+ 人工。

**参考 spec:** `docs/superpowers/specs/2026-06-07-p2-home-dashboard-design.md`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src-tauri/src/metrics.rs` | +`DiskStats`、+`df` 探针与解析、+`MetricsManager` ref-count |
| `src/types/serverMetrics.ts` | 镜像 `DiskStats` + `disk` |
| `src/hooks/useAssetData.ts` | 新增：资产数据/handlers 共享 hook |
| `src/components/AssetTable/AssetTable.tsx` | 改用 hook；加「卡片/列表」切换 |
| `src/components/AssetDashboard/AssetDashboard.tsx` | 新增：分组卡片网格 + 实时指标接线 |
| `src/components/AssetDashboard/HostDashCard.tsx` | 新增：单卡两态 |
| `src/components/AssetDashboard/AssetDashboard.css` | 新增：卡片样式（令牌化） |
| `src/stores/settingsStore.ts` + `src/components/Settings/SettingsModal.tsx` | +`homeView` 默认（两处） |
| `src/i18n/locales/gwshell.{en,zh}.json` | 文案 |

---

## Task 1: 后端磁盘采集（DiskStats + df 探针）

**Files:** Modify `src-tauri/src/metrics.rs`, `src/types/serverMetrics.ts`

- [ ] **Step 1: 加 `DiskStats` 结构 + 进 `MetricsSnapshot`**

在 `metrics.rs` 的 `NetStats` 之后加：
```rust
#[derive(Debug, Serialize, Clone, Default)]
pub struct DiskStats {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub mount: String,
}
```
在 `MetricsSnapshot` 里加字段（放在 `net` 后）：
```rust
    pub disk: Option<DiskStats>,
```

- [ ] **Step 2: 加 `parse_df` 解析函数**

`df -kP /` 输出形如：
```
Filesystem     1024-blocks     Used Available Capacity Mounted on
/dev/sda1         41251136 12345678  26800000      32% /
```
加解析（取第 2 数据行，单位 KiB→bytes）：
```rust
/// Parse `df -kP /` output. Returns DiskStats for the (single) data row.
pub fn parse_df(text: &str) -> Option<DiskStats> {
    let line = text.lines().nth(1)?;            // skip header
    let cols: Vec<&str> = line.split_whitespace().collect();
    if cols.len() < 6 { return None; }
    let total_kb: u64 = cols[1].parse().ok()?;
    let used_kb: u64 = cols[2].parse().ok()?;
    let mount = cols[cols.len() - 1].to_string();
    Some(DiskStats {
        total_bytes: total_kb.saturating_mul(1024),
        used_bytes: used_kb.saturating_mul(1024),
        mount,
    })
}
```

- [ ] **Step 3: 在探针批命令里加 DISK 段**

找到周期探针字符串（含 `echo '---LOAD---'; cat /proc/loadavg` 那段，约 line 598-602），在末尾追加一行：
```
echo '---DISK---';   df -kP / 2>/dev/null
```

- [ ] **Step 4: 在 `build_snapshot` 里解析 `---DISK---` 段并填入**

按现有 section 解析方式（与 `---LOAD---` 同款），提取 `---DISK---` 段文本传入 `parse_df`，把结果填入 `snapshot.disk`。读 `build_snapshot` 现有 section 切分逻辑，照搬模式新增 disk 分支。

- [ ] **Step 5: 镜像到 TS 类型**

`src/types/serverMetrics.ts`：加
```ts
export interface DiskStats {
  total_bytes: number;
  used_bytes: number;
  mount: string;
}
```
并在 `MetricsSnapshot` 加 `disk: DiskStats | null;`（放在 `net` 后）。

- [ ] **Step 6: 验证**

Run: `cd src-tauri && cargo build` → 通过。
Run: `cd .. && npm run build` → 通过（TS 镜像无误）。
（若 metrics.rs 有 `#[cfg(test)]` 解析测试，加一个 `parse_df` 单测；否则跳过。）

- [ ] **Step 7: Commit**
```bash
git add src-tauri/src/metrics.rs src/types/serverMetrics.ts
git commit -m "feat(metrics): collect root-fs disk usage via df (P2)"
```

---

## Task 2: MetricsManager 引用计数

**Files:** Modify `src-tauri/src/metrics.rs`

- [ ] **Step 1: 读现状**

Read `MetricsManager`（`start` / `stop` / `stop_all` / 内部 map）。确认每会话是否已有句柄 map。

- [ ] **Step 2: 加 ref-count**

为每个 `session_id` 维护计数（如 `HashMap<String, usize>` 或在现有句柄结构里加 `refs: usize`）：
- `start(session_id, ..)`：计数 +1；仅当从 0→1 时真正 spawn 轮询任务（现有逻辑）。已在运行则只增计数并返回。
- `stop(session_id)`：计数 -1；仅当降到 0 时真正中止任务并移除（现有逻辑）。
- `stop_all`：清零所有并中止。
保持现有的 emit / 任务体不变，只在外层包计数。注意加锁（现有 map 应已在 `Mutex`/`DashMap` 下，沿用）。

- [ ] **Step 3: 验证**

Run: `cd src-tauri && cargo build` → 通过。
逻辑核对：连续两次 `start` 同一 session 只启一个任务；两次 `stop` 才真正停。

- [ ] **Step 4: Commit**
```bash
git add src-tauri/src/metrics.rs
git commit -m "feat(metrics): ref-count pollers so panel+dashboard can share a session (P2)"
```

---

## Task 3: 抽取 `useAssetData` 共享 hook（纯重构）

**Files:** Create `src/hooks/useAssetData.ts`; Modify `src/components/AssetTable/AssetTable.tsx`

- [ ] **Step 1: 读 AssetTable，识别可共享逻辑**

Read `AssetTable.tsx` 全文。识别：session 列表来源、搜索过滤、`handleConnect`、ping(`doPing`)/latency map、选择/删除。

- [ ] **Step 2: 新建 hook**

`src/hooks/useAssetData.ts`，导出表格与仪表盘都要用的状态与方法：
```ts
export function useAssetData() {
  // sessions, groups, searchQuery+setSearchQuery, filteredSessions,
  // latencyMap, ping(sessionId)/pingAll, handleConnect(session),
  // selectedIds+toggleSelect, deleteSelected
  // ...移动 AssetTable 中对应实现到此，保持行为完全一致
  return { /* ...上述 */ };
}
```
**纯搬运**：把 AssetTable 里这些逻辑原样移入 hook，不改行为。

- [ ] **Step 3: AssetTable 改用 hook**

`AssetTable.tsx` 用 `const { ... } = useAssetData();` 替换被移走的本地实现；渲染（表格 JSX）保持不变。

- [ ] **Step 4: 验证（表格行为不变）**

Run: `npm run build && npm run smoke:check` → 通过。
浏览器桩（[[preview-tauri-app-in-browser]]）：主页表格视图渲染、搜索/空态与改前一致（截图比对）。

- [ ] **Step 5: Commit**
```bash
git add src/hooks/useAssetData.ts src/components/AssetTable/AssetTable.tsx
git commit -m "refactor(assets): extract useAssetData hook shared by table+dashboard (P2)"
```

---

## Task 4: `homeView` 设置 + 「卡片/列表」切换

**Files:** Modify `settingsStore.ts`, `SettingsModal.tsx`, `AssetTable.tsx`（工具栏）

- [ ] **Step 1: 加设置默认（两处，[[dual-appsettings-sync]]）**

`src/stores/settingsStore.ts`：`AppSettings` 接口加 `homeView: 'card' | 'table';`；`defaultSettings` 加 `homeView: 'card',`。
`src/components/Settings/SettingsModal.tsx`：同样在其 `AppSettings` 接口 + `defaultSettings` 两处加（值一致）。

- [ ] **Step 2: 校验两处一致**

Run: `grep -rn "homeView" src/stores/settingsStore.ts src/components/Settings/SettingsModal.tsx` → 接口 + 默认各两处、值一致。

- [ ] **Step 3: 工具栏切换控件**

在主页工具栏（`AssetTable` 顶部 `asset-toolbar-left`）加分段切换：
```tsx
const homeView = useSettingsStore((s) => s.settings.homeView);
const setSettings = useSettingsStore((s) => s.setSettings); // 用现有更新方法
// 渲染两个按钮「卡片/列表」，点击 setSettings({ homeView: 'card' | 'table' })
```
（用项目现有的 settings 更新 API；读 settingsStore 确认方法名。）

- [ ] **Step 4: 验证 + Commit**

Run: `npm run build && npm run smoke:check`。
```bash
git add src/stores/settingsStore.ts src/components/Settings/SettingsModal.tsx src/components/AssetTable/AssetTable.tsx
git commit -m "feat(home): add homeView setting + card/list toggle (P2)"
```

---

## Task 5: `HostDashCard` 单卡组件（两态，先不接实时）

**Files:** Create `src/components/AssetDashboard/HostDashCard.tsx`, `.../AssetDashboard.css`

- [ ] **Step 1: 卡片组件骨架**

```tsx
import type { SessionConfig, TabInfo } from '../../types';
import type { MetricsSnapshot } from '../../types/serverMetrics';

interface Props {
  session: SessionConfig;
  connected: boolean;
  snapshot?: MetricsSnapshot | null;   // live metrics when connected
  cpuHistory?: number[];               // sparkline
  latency?: number | null;             // ping ms when not connected
  onConnect: (s: SessionConfig) => void;
  onEdit: (s: SessionConfig) => void;
  onFocus?: (s: SessionConfig) => void; // focus existing tab if connected
}

export const HostDashCard: React.FC<Props> = ({ session, connected, snapshot, cpuHistory, latency, onConnect, onEdit, onFocus }) => {
  // header: status dot (ok/off) + name + color tag stripe + actions (edit, connect/focus)
  // connected: <MetricStrip snapshot cpuHistory/>  (CPU ring, MEM bar, DISK bar, LOAD chip, net sparkline)
  // disconnected: ping badge + 连接 + last-seen
};
```
指标小件（同文件内小组件或内联）：
- CPU 环：`conic-gradient(var(--accent) calc(p%), var(--border-color) 0)`；阈值色 <70 `--accent` / 70–90 `--warning` / >90 `--danger`。
- 内存条/磁盘条：`width: used/total%`；磁盘来自 `snapshot.disk`（无则隐藏该条）。
- 负载：`snapshot.cpu.loadavg_1m`（按核数着色：>cores 警示）。
- sparkline：`<svg><polyline points=.../></svg>`，数据 = `cpuHistory`。

- [ ] **Step 2: 卡片样式（令牌化）**

`AssetDashboard.css`：`.dash-card`（`--bg-card`/`--radius-md`/`--border-color`），连接态边框 `rgba(var(--accent-primary-rgb), .35)`；标签色条；指标小件样式。**禁止硬编码颜色**，全用 P1 令牌。

- [ ] **Step 3: 验证（静态渲染）**

Run: `npm run build`。先在 Task 6 接入网格后用桩截图看卡。此步仅保证编译通过。

- [ ] **Step 4: Commit**
```bash
git add src/components/AssetDashboard/HostDashCard.tsx src/components/AssetDashboard/AssetDashboard.css
git commit -m "feat(dashboard): HostDashCard with connected/offline states (P2)"
```

---

## Task 6: `AssetDashboard` 分组网格 + 接入主页

**Files:** Create `src/components/AssetDashboard/AssetDashboard.tsx`; Modify `AssetTable.tsx` 或主页渲染处

- [ ] **Step 1: 仪表盘组件**

```tsx
export const AssetDashboard: React.FC = () => {
  const { filteredSessions, groups, handleConnect, latencyMap, ... } = useAssetData();
  const { tabs, sessions, setActiveTab, setShowNewSession } = useAppStore(...);
  const connectedBySession = useMemo(() => /* sessionId -> tab for ssh && connected */, [tabs]);
  // group sessions by SessionGroup; render each group: <div class="dash-grp">name</div>
  // grid: <div class="dash-grid"> sessions.map -> <HostDashCard
  //   connected={!!connectedBySession[s.id]} latency={latencyMap[s.id]}
  //   onConnect={handleConnect} onEdit=... onFocus=... /> </div>
};
```
网格 CSS（布局 A）：`.dash-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:12px; }`。

- [ ] **Step 2: 主页按 homeView 切换渲染**

在主页渲染处（`AssetTable` 内部或其父）：`homeView === 'card' ? <AssetDashboard/> : <表格JSX>`。工具栏（搜索/新建/切换）对两视图共用。

- [ ] **Step 3: 验证（桩截图）**

Run: `npm run build && npm run smoke:check`。
浏览器桩：注入若干假 session（或用真应用）确认——默认进卡片视图、按分组、卡片两态、切到列表是原表格。截图确认布局 A 紧凑。

- [ ] **Step 4: Commit**
```bash
git add src/components/AssetDashboard/AssetDashboard.tsx src/components/AssetTable/AssetTable.tsx
git commit -m "feat(dashboard): grouped host-card grid as default home view (P2)"
```

---

## Task 7: 已连接卡实时指标接线

**Files:** Modify `src/components/AssetDashboard/AssetDashboard.tsx`

- [ ] **Step 1: 为已连接会话启动/订阅指标**

在 `AssetDashboard` 内 `useEffect`：
```ts
// connectedSshSessionIds = tabs.filter(t=>t.type==='ssh' && t.connected).map(t=>t.sessionId)
// for each id: invoke('start_server_metrics', { sessionId: id }); listen(`server-metrics-${id}`, e => setSnap(id, e.payload))
// cleanup: unlisten all; for each id: invoke('stop_server_metrics'... or existing stop cmd)
```
读 ServerPanel.tsx 复用其 invoke 命令名/事件名（`server-metrics-${id}` / `server-metrics-error-${id}`）与 history 节流模式。指标快照存 `Record<sessionId, MetricsSnapshot>`，CPU history 存 `Record<sessionId, number[]>`（长度 ≤60），节流 forceRender。

- [ ] **Step 2: 喂给卡片**

`<HostDashCard snapshot={snaps[s.id]} cpuHistory={cpuHist[s.id]} .../>`。错误/不支持 → 卡片指标降级占位（不弹窗）。

- [ ] **Step 3: 生命周期正确**

仅在 `AssetDashboard` 挂载（主页卡片视图可见）时轮询；卸载/切到列表/切到终端标签时 stop（ref-count 保证不影响抽屉）。

- [ ] **Step 4: 验证（真应用）**

Run: `npm run build && npm run smoke:check`。
真应用：连 1–2 台 SSH → 主页卡片实时显示 CPU/内存/磁盘/负载/网络；断开降级；与服务器面板抽屉同开同一台无冲突。

- [ ] **Step 5: Commit**
```bash
git add src/components/AssetDashboard/AssetDashboard.tsx
git commit -m "feat(dashboard): live metrics on connected host cards (P2)"
```

---

## Task 8: i18n 文案

**Files:** Modify `src/i18n/locales/gwshell.en.json`, `gwshell.zh.json`

- [ ] **Step 1: 加键**

两个文件都加（命名空间 `gwshell`，键对齐现有风格）：
`home_view_card`（卡片/Cards）、`home_view_list`（列表/List）、`dash_disk`（磁盘/Disk）、`dash_load`（负载/Load）、`dash_offline`（离线/Offline）、`dash_connect`（连接/Connect）、`dash_last_seen`（上次/Last seen）、`dash_online_count`（"{{online}} 在线 / {{total}} 台"）。卡片里所有可见文案用 `t(...)`，不硬编码中文。

- [ ] **Step 2: 校验 + Commit**

Run: `npm run build`（i18n 类型若由 keys 生成则验证）。
```bash
git add src/i18n/locales/gwshell.en.json src/i18n/locales/gwshell.zh.json src/components/AssetDashboard
git commit -m "i18n(dashboard): card/list, disk, load, offline strings (P2)"
```

---

## Task 9: 终验

- [ ] **Step 1: 全量构建**

Run: `cd src-tauri && cargo build && cd .. && npm run build && npm run smoke:check` → 全过。

- [ ] **Step 2: 人工验收（真应用 `npm run tauri dev`）**

- [ ] 主页默认卡片视图，按分组排列，布局 A 紧凑
- [ ] 已连接 SSH 卡实时显示 CPU 环 / 内存条 / 磁盘条 / 负载 / 网络 sparkline
- [ ] 未连接卡显示 ping 延迟 + 连接 + 上次连接
- [ ] 「卡片/列表」切换正常，列表仍是原表格且功能不变
- [ ] 配色/圆角全部跟随 P1 令牌；语言切换不丢指标
- [ ] 服务器面板抽屉 + 仪表盘对同一主机同时取指标无冲突

- [ ] **Step 3: 收尾**

按 `superpowers:finishing-a-development-branch` 处理。

---

## 自查（spec 覆盖）

- §3.1 磁盘 → T1 ✓
- §3.2 ref-count → T2 ✓
- §4.1 homeView+切换 → T4 ✓
- §4.2 组件 + useAssetData → T3/T5/T6 ✓
- §4.3 实时指标接线 → T7 ✓
- §5 卡片视觉 → T5 ✓
- i18n → T8 ✓
- §8 验证 → T9 ✓
