# cc-switch 全量并入 gwshell · 一次性切换架构说明

**日期**：2026-04-08
**类型**：替代性架构说明
**状态**：生效中的新方向
**用途**：当目标从“兼容式分阶段移植”切换为“新架构一次性替换”时，本文件优先于旧路线图

---

## 1. 结论

当前仓库已经落下了一层 stage-0 过渡骨架，但你的新要求已经明确否定了两件事：

1. 不继续兼容 gwshell 旧 AI 设计
2. 不继续兼容 cc-switch 现有实现形态本身，而是借其能力域重建为更新的系统架构

因此，后续实现不应再围绕“把 cc-switch 文件逐目录搬进 gwshell”展开，而应改成：

- 保留已验证可复用的基础设施
- 丢弃旧的 AI 前后端实现与过渡组件
- 以单一 AI 平台子系统的方式重建前端与 Rust 后端
- 在一次切换中替换 Settings -> AI 整个区域及其后端命令面

这意味着旧路线图中的“10 个阶段”只适合作为能力清单，不再适合作为实现结构。

---

## 2. 新目标

在 gwshell 内构建一个新的 AI 平台子系统，满足以下要求：

- 从用户视角，覆盖 cc-switch 的全部能力域：Providers、MCP、Prompts、Skills、Agents、Usage、Proxy、Failover、OpenClaw、Universal、Workspace、WebDAV、Auth、Session Manager、Deeplink
- 从工程视角，不保留旧 gwshell AI 模块作为长期兼容层
- 从架构视角，使用 feature-first + modular-monolith 方案，而不是继续叠加 Settings 子组件和旧 Tauri commands
- 从运行时视角，与 gwshell 的 SSH / PTY / Serial / Docker / SFTP 外壳保持明确边界，只共享主题、语言和窗口宿主

---

## 3. 现有基础中允许保留的内容

以下内容已经验证有效，可继续作为新架构底座使用：

- [src/components/ai/i18n/index.ts](src/components/ai/i18n/index.ts)：统一 i18next 实例与 `gwshell` / `ai` namespace 骨架
- [src/i18n/index.ts](src/i18n/index.ts)：旧入口兼容再导出层，可在切换完成前暂存
- [src/App.tsx](src/App.tsx)：已接入 `I18nextProvider`
- [src/components/Settings/SettingsModal.tsx](src/components/Settings/SettingsModal.tsx)：AI 标签页已具备单入口挂载点
- [src/components/ai/styles/ai.css](src/components/ai/styles/ai.css)：当前 scoped 样式变量体系
- [tailwind.config.cjs](tailwind.config.cjs) 与 [postcss.config.cjs](postcss.config.cjs)：Tailwind / PostCSS 基础设施
- [src-tauri/src/ai/mod.rs](src-tauri/src/ai/mod.rs)：Rust AI 子系统命名空间入口

以下内容不应继续扩展，只可作为短期参考或迁移输入：

- [src/components/Settings/ProviderEditor.tsx](src/components/Settings/ProviderEditor.tsx)
- [src/components/Settings/McpManager.tsx](src/components/Settings/McpManager.tsx)
- [src/components/Settings/PromptsManager.tsx](src/components/Settings/PromptsManager.tsx)
- [src/components/Settings/UsageDashboard.tsx](src/components/Settings/UsageDashboard.tsx)
- [src-tauri/src/ai_config.rs](src-tauri/src/ai_config.rs)
- [src-tauri/src/mcp_config.rs](src-tauri/src/mcp_config.rs)
- [src-tauri/src/prompt_config.rs](src-tauri/src/prompt_config.rs)
- [src-tauri/src/usage_tracker.rs](src-tauri/src/usage_tracker.rs)

---

## 4. 前端新架构

前端不再继续以 `src/components/Settings/*` 方式累加 AI 页面，而改为单独的 feature 根：

```text
src/
├── features/
│   └── ai-platform/
│       ├── app/
│       │   ├── AiPlatformRoot.tsx
│       │   ├── AiPlatformProviders.tsx
│       │   ├── AiPlatformShell.tsx
│       │   └── app-router.tsx
│       ├── domains/
│       │   ├── providers/
│       │   ├── mcp/
│       │   ├── prompts/
│       │   ├── skills/
│       │   ├── agents/
│       │   ├── usage/
│       │   ├── proxy/
│       │   ├── openclaw/
│       │   ├── universal/
│       │   ├── workspace/
│       │   ├── sessions/
│       │   ├── auth/
│       │   └── settings/
│       ├── shared/
│       │   ├── ui/
│       │   ├── forms/
│       │   ├── tables/
│       │   ├── charts/
│       │   ├── hooks/
│       │   ├── lib/
│       │   ├── i18n/
│       │   └── styles/
│       ├── infra/
│       │   ├── api/
│       │   ├── commands/
│       │   ├── query/
│       │   └── persistence/
│       └── index.ts
└── components/
    └── Settings/
        └── SettingsModal.tsx
```

### 4.1 前端设计原则

- 以 domain 为边界，而不是按“页面文件夹”简单平铺
- 所有服务端状态走 TanStack Query
- 所有复杂表单走 React Hook Form + Zod
- UI 组件只放 shared/ui，不在业务域里复制 shadcn 组件
- SettingsModal 只负责挂载 AI 平台根，不承载 AI 业务逻辑
- `src/components/ai` 现有骨架最终应迁移到 `src/features/ai-platform`；旧目录可在 cutover 完成后清理

### 4.2 路由与壳层

AI 区域内部需要自己的应用壳，不再依赖 Settings 的左右结构拼装：

- 左侧：AppSwitcher + 一级能力导航
- 中央：按 domain 渲染的主工作区
- 右侧：上下文详情面板 / inspector / log drawer
- 顶部：搜索、当前 provider、环境状态、代理状态、更新提示

这不是 cc-switch 当前 UI 的机械复制，而是把其能力以更稳定的壳层承载。

---

## 5. 后端新架构

Rust 端不再围绕“一个文件一个 command 集合”的迁移思路，而改为 AI 平台模块化单体：

```text
src-tauri/src/
├── ai_platform/
│   ├── mod.rs
│   ├── application/
│   │   ├── providers/
│   │   ├── mcp/
│   │   ├── prompts/
│   │   ├── skills/
│   │   ├── agents/
│   │   ├── usage/
│   │   ├── proxy/
│   │   ├── sync/
│   │   ├── auth/
│   │   └── sessions/
│   ├── domain/
│   │   ├── provider.rs
│   │   ├── model.rs
│   │   ├── prompt.rs
│   │   ├── mcp.rs
│   │   ├── usage.rs
│   │   ├── failover.rs
│   │   └── errors.rs
│   ├── infrastructure/
│   │   ├── db/
│   │   ├── fs/
│   │   ├── config_bridge/
│   │   ├── proxy/
│   │   ├── webdav/
│   │   ├── auth/
│   │   └── deeplink/
│   ├── interfaces/
│   │   ├── commands/
│   │   ├── events/
│   │   └── dto/
│   └── runtime/
│       ├── bootstrap.rs
│       ├── background_jobs.rs
│       └── state.rs
└── lib.rs
```

### 5.1 后端设计原则

- 命令层、应用层、基础设施层分离
- 所有 Tauri command 统一 `ai_*` 前缀
- 不复用旧 `ai_config.rs` / `mcp_config.rs` 的数据结构
- 配置桥接属于 infrastructure，不直接污染 domain 类型
- 代理服务、健康检查、故障转移是 runtime + infrastructure 组合，而不是零散 util

### 5.2 数据存储

- 新 AI 平台使用独立 SQLite：`ai.db`
- 旧 gwshell AI 数据只做一次导入，不作为长期双写源
- 导入器是显式 migration command，不是隐式运行时兼容层
- 导入成功后，旧模块进入冻结状态，cutover 后直接删除

---

## 6. 技术栈原则

### 6.1 前端

- React 19
- TypeScript 5.8+
- Vite 7
- i18next + react-i18next
- TanStack Query
- React Hook Form + Zod
- Tailwind + Radix + shadcn/ui
- Framer Motion
- Recharts
- CodeMirror

### 6.2 后端

- Tauri 2
- tokio
- rusqlite
- axum / hyper / tower 代理链路
- reqwest 作为外连客户端
- serde + thiserror + anyhow
- rustls 体系

### 6.3 明确不用

- 不把 AI 业务状态塞回 gwshell 的 appStore
- 不继续扩展旧 ProviderEditor
- 不在 Settings 子目录里继续堆叠 AI 子模块
- 不保留双实现长期共存

---

## 7. 一次性切换策略

旧路线图的“10 阶段”可被压缩为 4 条并行工作流，而不是 10 次用户可见半成品：

### 工作流 A：平台骨架

- 建立前端 `features/ai-platform`
- 建立 Rust `ai_platform`
- 建立统一 provider/query/theme/i18n bridge

### 工作流 B：核心能力域

- Providers
- MCP
- Prompts
- Skills
- Agents
- Usage

### 工作流 C：系统能力域

- Proxy / Failover / Health
- OpenClaw / Universal / Workspace
- Auth / WebDAV / Subscription / Coding Plan
- Session Manager / Deeplink

### 工作流 D：切换与清理

- 数据导入器
- Settings AI 挂载切换
- 旧前端组件删除
- 旧 Rust 模块删除
- 回归验证

用户可见结果只有两种状态：

1. 旧 AI 系统仍在
2. 新 AI 平台完全接管

中间不再暴露“半完成阶段 UI”。

---

## 8. 对当前仓库的直接影响

若按本说明执行，以下现有内容会被视为短期可复用、长期将被迁移或替换：

- `src/components/ai/*` 当前文件：仅作为阶段性骨架，最终迁移到 `src/features/ai-platform/*`
- `src/i18n/index.ts` 兼容导出：在切换完成后可以瘦身，但无需立刻删除
- `SettingsModal`：保留宿主职责，移除 AI 业务职责
- `src-tauri/src/ai/mod.rs`：改造成 `ai_platform/mod.rs` 或作为中间门面转发

---

## 9. 切换门槛

只有在以下条件全部满足时，才允许切换到新 AI 平台并删除旧模块：

- Providers / MCP / Prompts / Skills / Usage 已可用
- 配置桥接已打通至少 Claude / Codex / Gemini
- 新 `ai.db` 已可从旧数据导入
- `npm run build`、`cargo build --manifest-path src-tauri/Cargo.toml`、`npm run tauri build` 全通过
- Settings -> AI 入口只剩一个新根组件
- 旧前端与旧 Rust 模块删除后仍能构建

---

## 10. 现实约束

当前外部参考代码规模大致为：

- cc-switch 前端文件：344
- cc-switch 组件文件：170
- cc-switch Rust 源文件：163
- cc-switch command 文件：29

因此，“一次性做完”在工程语义上可以成立，但在执行语义上不能等同于“单回合内无审查地把数百文件重写完毕”。

本文件的作用，是把目标从“兼容式分阶段移植”正式切换为“单系统 cutover 重构”，后续所有实现都应以此为准。
