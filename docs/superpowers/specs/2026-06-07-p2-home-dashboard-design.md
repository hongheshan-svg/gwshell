# P2 · 主页仪表盘（Home Dashboard）设计

**日期:** 2026-06-07
**状态:** 待用户确认
**所属:** GWShell UI 现代化，子项目 2 / 4（依赖 P1 令牌与 theme.css）

---

## 1. 背景与目标

P1 完成了视觉地基。P2 把**主页（`asset-list` 标签）**从一张干瘪的资产表格，升级为**二合一卡片仪表盘**——这是 Tabby/WindTerm/electerm 都没有的差异化王牌：

- 覆盖**所有**保存主机（卡片墙，资产管理）；
- 其中**已连接**的 SSH 会话卡片自动"活"起来，显示实时 CPU/内存/磁盘/负载/网络（在线监控）；
- 未连接主机显示 ping 延迟 + 快连 + 上次连接。

复用现有指标基建（`MetricsManager` + `server-metrics-{sessionId}` 事件 + ServerPanel 的卡片组件思路）。

---

## 2. 已锁定决策

| 决策 | 结论 |
|---|---|
| 形态 | ③ 二合一：卡片墙 + 已连接卡实时指标 |
| 与表格关系 | **并存**，主页顶部「卡片 / 列表」切换，**默认卡片** |
| 布局 | A 紧凑：响应式网格，每行 3–4 卡 |
| 分组 | 保留，按现有 `SessionGroup` 分组排列 |
| 卡片指标（已连接） | CPU% / 内存% / **磁盘%** / 负载(1m) / 网络 sparkline |
| 卡片（未连接） | ping 延迟徽章 + 「▷ 连接」+ 上次连接 |

---

## 3. 需要的后端新增（Rust）

现有 `MetricsSnapshot` 采集了 cpu / mem / net / loadavg / procs / nics，但**没有磁盘**，且指标轮询器的生命周期是为"单个活跃会话"设计的。P2 需要两处后端改动：

### 3.1 磁盘采集（新增 `DiskStats`）
- `src-tauri/src/metrics.rs`：新增
  ```rust
  pub struct DiskStats {
      pub total_bytes: u64,
      pub used_bytes: u64,
      pub mount: String,   // 根分区 "/"
  }
  ```
  在 `MetricsSnapshot` 加 `pub disk: Option<DiskStats>`。
- 探针：在指标 tick 里追加一条 `df -kP /`（或 `df -kP` 取根挂载），解析已用/总量。与现有 cpu/mem 探针同批执行，避免额外往返。
- `src/types/serverMetrics.ts`：镜像加 `DiskStats` + `disk: DiskStats | null`。

### 3.2 指标轮询器 ref-count（并发多卡共存）
现 `MetricsManager.start(session_id)` / `stop(session_id)` 面向单一订阅者（ServerPanel 抽屉）。仪表盘会**为所有已连接 SSH 会话同时启动轮询器**，且可能与抽屉对同一会话重复 start/stop。
- 改 `MetricsManager`：对每个 `session_id` 维护**引用计数**——`start` 递增（首次才真正启动 tokio 轮询任务），`stop` 递减（归零才真正停止）。保证抽屉与仪表盘互不踩踏。
- 若已是幂等实现则只需补 ref-count；实现时先读 `metrics.rs` 现状确认。

---

## 4. 前端架构

### 4.1 视图切换
- 主页（`asset-list`）顶部工具栏加「卡片 / 列表」分段切换。
- 持久化：**已定**——新增 `homeView: 'card' | 'table'`（默认 `'card'`）存于 `settingsStore`（持久化，记住偏好）。**遵守 [[dual-appsettings-sync]]**：`AppSettings` 接口 + `defaultSettings` 在 `settingsStore.ts` 与 `SettingsModal.tsx` **两处都要加** `homeView`。切换控件放在主页工具栏（不进设置面板），故无需新增设置面板行；i18n 仅需「卡片/列表」按钮文案。

### 4.2 组件
- **新增 `src/components/AssetDashboard/AssetDashboard.tsx`** —— 卡片网格主体。按 `SessionGroup` 分组渲染；每组一个 `dash-grp` 标题 + 响应式 grid（`grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))`，即布局 A）。
- **新增 `src/components/AssetDashboard/HostDashCard.tsx`** —— 单卡（区别于 ServerPanel 的 `HostCard`）。Props：`session`, `tab?`(连接态), `snapshot?`(实时), `latency?`。两态渲染：
  - **已连接**：状态点亮绿 + 名称 + 标签色条；右上 ✎编辑 / ▷聚焦该标签；指标区 = CPU 环 + 内存条 + 磁盘条 + 负载 chip + 网络 sparkline。
  - **未连接**：ping 徽章（复用资产表的 ping）+「▷ 连接」(`handleConnect`) + 上次连接时间。
- **新增 `src/components/AssetDashboard/AssetDashboard.css`**（或并入 theme 化的 global）。卡片复用 P1 令牌（`--bg-card`/`--radius-md`/`--accent-*` 等），不得硬编码颜色。
- **复用/抽取**：`AssetTable.tsx` 的数据与 handlers（`handleConnect`、ping 逻辑、session 列表、搜索过滤）抽到一个共享 hook `useAssetData()`，供表格与仪表盘共用，避免重复。`AssetTable` 当前 380 行，抽取后更聚焦。

### 4.3 实时指标接线
- `AssetDashboard` 挂载时：对所有**已连接的 SSH 标签**（`tabs.filter(type==='ssh' && connected)`）调用 `start_server_metrics(session_id)`，并 `listen('server-metrics-{sessionId}')` 收快照存入按 sessionId 索引的 map（节流重渲染，参考 ServerPanel 的 `forceRender` 节流 + history ref）。
- 卸载/离开主页时：对这些 session 调 `stop`（ref-count 保证不影响抽屉）。
- 每张已连接卡维护自己的 sparkline history（CPU 或 net），长度 ~30–60。
- 错误（`unsupported`/`disconnected`）：卡片指标区降级为"连接中/不支持"占位，不报红弹窗。

---

## 5. 卡片视觉（布局 A，已确认的 mockup）

- 卡：`--bg-card` 底、`--radius-md` 角、`--border-color` 边；已连接卡边框带轻微 `--accent` 染色。
- 左侧 3px 标签色条（来自 session 的 color tag）。
- 指标紧凑两区：左 CPU 环（conic-gradient，按 % 着色：<70 靛蓝 / 70–90 琥珀 / >90 红）；右两条（内存、磁盘）+ 负载文本 + sparkline。
- 颜色全部走令牌；CPU/内存/磁盘阈值色用 `--accent` / `--warning` / `--danger`。

---

## 6. 影响文件

| 文件 | 改动 |
|---|---|
| `src-tauri/src/metrics.rs` | 加 `DiskStats` + `df` 探针；`MetricsManager` ref-count | 
| `src/types/serverMetrics.ts` | 镜像 `DiskStats` + `disk` 字段 |
| `src/components/AssetDashboard/AssetDashboard.tsx` | 新增：分组卡片网格 + 实时指标接线 |
| `src/components/AssetDashboard/HostDashCard.tsx` | 新增：单卡两态 |
| `src/components/AssetDashboard/AssetDashboard.css` | 新增：卡片样式（令牌化） |
| `src/hooks/useAssetData.ts` | 新增：抽取资产数据/handlers（表格+仪表盘共用） |
| `src/components/AssetTable/AssetTable.tsx` | 改用 `useAssetData`；加「卡片/列表」切换；表格视图保留 |
| `src/stores/settingsStore.ts` + `SettingsModal.tsx` | 新增 `homeView` 默认（[[dual-appsettings-sync]]） |
| `src/i18n/locales/gwshell.{en,zh}.json` | 卡片/列表、磁盘、负载等文案 |

---

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 多连接同时轮询的 SSH 负载 | 仅对**已连接**会话轮询（数量有限）；仅在主页可见时轮询；tick 间隔沿用现值；ref-count 防重复 |
| 抽屉与仪表盘对同一 session 抢 start/stop | `MetricsManager` ref-count |
| `df` 在非 Linux/受限环境失败 | `disk: Option`，失败则卡片磁盘条降级隐藏；与现有 `unsupported` 降级一致 |
| 多卡频繁重渲染卡顿 | 按 sessionId 存快照 + 节流 forceRender（参考 ServerPanel）；sparkline 用轻量 svg polyline |
| AssetTable 抽取 hook 破坏现有表格 | 先抽 `useAssetData` 保持表格行为不变（纯重构）再加仪表盘 |

---

## 8. 验证

1. `npm run build` + `npm run smoke:check` 通过；`cargo` 编译通过（metrics.rs 改动）。
2. 浏览器桩（见 [[preview-tauri-app-in-browser]]）截图：主页默认卡片视图、分组、卡片两态、切到列表仍为原表格。
3. 真应用：连接 1–2 台 SSH，主页卡片实时显示 CPU/内存/磁盘/负载/网络；断开后降级为 ping+连接；切换卡片/列表正常；语言切换不丢指标。
4. 抽屉 + 仪表盘同时对一台主机取指标无冲突（ref-count 验证）。

---

## 9. 不在 P2 范围

- 真·OS vibrancy（P-future）。
- 命令优先导航（P3）。
- 终端 Block 化（P4）。
- 对**未连接**主机做后台实时探测（不做——太重/打扰；仅 ping）。
- 磁盘多分区明细（仅根分区；多分区可后续）。
