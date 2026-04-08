# cc-switch 全量移植到 gwshell · 路线图设计

**日期**：2026-04-08
**类型**：多阶段移植路线图（meta-spec）
**状态**：草案，待用户审阅

---

## 1. 目标

把 `D:\toolsource\cc-switch` 的全部 AI 助手功能（Claude Code / Codex / Gemini CLI 多 provider 管理、MCP / Prompts / Skills / Agents、Usage 仪表盘、反向代理 / 故障转移、OpenClaw / OMO / Universal、WebDAV 同步等）完整移植到 gwshell，**替换** gwshell 当前 `Settings → AI` 区域。要求与 cc-switch 行为、UI、数据格式 100% 一致。

## 2. 范围与决策（已与用户对齐）

| # | 决策点 | 选择 |
|---|---|---|
| 1 | 嵌入位置 | **A** — 替换 `Settings → AI` 区域，沿用 cc-switch 的左侧 AppSwitcher 导航风格 |
| 2 | UI 技术栈 | **B** — 引入 cc-switch 全套依赖（tailwind / shadcn / Radix / react-hook-form / zod / react-query / framer-motion / recharts / i18next / sonner），但在 AI 区域内 scoped；tailwind 加 prefix 隔离，避免污染 gwshell 终端/SFTP/会话现有样式 |
| 3 | 数据兼容 | **A** — 写一次性 migration 脚本把 gwshell 现有 `ai_config.rs` / `mcp_config.rs` / `usage_tracker.rs` 数据导入 cc-switch 的 SQLite schema，迁移完成后**废弃旧的** Rust 模块和旧的 `ProviderEditor.tsx` / `McpManager.tsx` / `PromptsManager.tsx` / `UsageDashboard.tsx` |
| 4 | 多语言 | **D（修订）** — 全项目切换到 i18next + react-i18next。废弃现有 `src/i18n/getT()` 系统：把 `zh.ts`/`en.ts` 转换成 i18next 资源 namespace（`gwshell` namespace），cc-switch 翻译资源作为另一个 namespace（`ai`）共存于同一个 i18next 实例。`appStore.locale` 改为从 `i18next.language` 派生。所有 12 个 consumer 文件（含 TerminalView、IconNav、DockerModal、NewSessionModal、NewAssetMenu、SettingsModal 等）改用 `useTranslation('gwshell')` |

## 3. 整体架构

```
gwshell/
├── src/
│   ├── App.tsx                  # 顶层包 <I18nextProvider>；Settings 入口指向新 AiSection
│   ├── i18n/
│   │   ├── index.ts             # 改造：导出 i18next 实例，注册 gwshell + ai 两个 namespace
│   │   ├── gwshell.zh.ts        # 由旧 zh.ts 转换而来
│   │   ├── gwshell.en.ts        # 由旧 en.ts 转换而来
│   │   └── ai.*.json            # cc-switch 翻译资源原样搬运
│   ├── stores/appStore.ts       # locale 字段由 i18next.language 派生；setLocale 调用 i18next.changeLanguage()
│   ├── components/
│   │   ├── Settings/
│   │   │   └── SettingsModal.tsx  # 改造：AI 标签页 mount <AiSection/>
│   │   └── ai/                  # 新建 — 整个 cc-switch 移植落地点
│   │       ├── AiSection.tsx    # 顶层容器：i18next Provider + react-query Provider + theme + AppSwitcher
│   │       ├── providers/       # 对应 cc-switch src/components/providers/
│   │       ├── mcp/             # 对应 cc-switch src/components/mcp/
│   │       ├── prompts/
│   │       ├── skills/
│   │       ├── agents/
│   │       ├── usage/
│   │       ├── proxy/
│   │       ├── openclaw/
│   │       ├── universal/
│   │       ├── workspace/
│   │       ├── sessions/
│   │       ├── deeplink/
│   │       ├── env/
│   │       ├── settings/        # cc-switch 的 17 个面板
│   │       ├── common/
│   │       ├── ui/              # shadcn 组件
│   │       ├── config/          # presets
│   │       ├── hooks/
│   │       ├── lib/
│   │       ├── i18n/            # i18next 资源
│   │       └── styles/
│   │           └── ai.css       # tailwind 编译产物，prefix=ai-
│   └── ...
├── src-tauri/
│   ├── Cargo.toml               # 增加 cc-switch 全部 Rust 依赖
│   └── src/
│       ├── lib.rs               # 注册 cc-switch 命令；保留 gwshell 自有命令
│       ├── ai/                  # 新建命名空间，承载所有 cc-switch 后端代码
│       │   ├── mod.rs
│       │   ├── provider.rs
│       │   ├── provider_defaults.rs
│       │   ├── store.rs
│       │   ├── config.rs
│       │   ├── app_config.rs
│       │   ├── settings.rs
│       │   ├── claude_mcp.rs
│       │   ├── codex_config.rs
│       │   ├── gemini_config.rs
│       │   ├── opencode_config.rs
│       │   ├── openclaw_config.rs
│       │   ├── prompt.rs
│       │   ├── prompt_files.rs
│       │   ├── usage_script.rs
│       │   ├── database/        # schema/migration/dao/backup
│       │   ├── commands/        # 28 个 command 文件
│       │   ├── services/        # 18 个 service 文件
│       │   ├── proxy/           # 反向代理子系统
│       │   ├── mcp/
│       │   ├── session_manager/
│       │   └── deeplink/
│       ├── ai_config.rs         # ⚠️ 阶段 1 完成迁移后删除
│       ├── mcp_config.rs        # ⚠️ 阶段 1 完成迁移后删除
│       ├── usage_tracker.rs     # ⚠️ 阶段 5 完成迁移后删除
│       └── ...其它 gwshell 原有模块（ssh/pty/serial/database 不动）
```

### 关键隔离策略

1. **样式隔离**：tailwind 配置 `prefix: 'ai-'` 和 `corePlugins.preflight: false`；所有 cc-switch 组件 className 加 `ai-` 前缀（用脚本批量重写）；CSS 变量和 reset 仅作用于 `<AiSection>` 根节点
2. **状态隔离**：AI 区域内部用 react-query 管理服务端状态；不直接写 gwshell 的 Zustand store；只通过 `useEffect` 桥接 locale 与 theme
3. **依赖隔离**：tauri 命令命名加前缀 `ai_*`（除非 cc-switch 原命令名已经唯一），避免和 gwshell 现有命令冲突
4. **数据库隔离**：cc-switch 的 SQLite 文件单独存放（`%APPDATA%/gwshell/ai.db`），不和 gwshell 现有 SQLite 混用

## 4. 阶段划分（10 个阶段）

每个阶段有独立的 spec → plan → 实现 → 验收。完成后用户可独立验证、回滚。

### 阶段 0 — 基础设施铺底
**目标**：为后续阶段准备好编译环境，不引入任何新功能。

- 前端依赖：tailwindcss + postcss + autoprefixer（带 `prefix: 'ai-'` 配置）、shadcn-ui 必需的 Radix 组件（17 个）、react-hook-form、@hookform/resolvers、zod、@tanstack/react-query、framer-motion、recharts、i18next、react-i18next、sonner、cmdk、flexsearch、smol-toml、jsonc-parser、@dnd-kit、lucide-react 升级到 ^0.542、codemirror 全套
- 后端依赖：toml + toml_edit、indexmap、sha2、json5、json-five、rust_decimal、reqwest（features 升级）、axum + hyper + tower + tower-http + hyper-util + hyper-rustls + tokio-rustls + rustls + webpki-roots + rustls-native-certs、http + http-body + http-body-util + httparse、chrono、anyhow、thiserror、async-stream、bytes、futures、zip、brotli、flate2、rquickjs、auto-launch、tauri-plugin-store、tauri-plugin-process、tauri-plugin-log、winreg(win)、objc2(macos)
- React 19 兼容性验证：Radix v1.x、react-hook-form v7、framer-motion v12 在 React 19 下的状态确认；如有问题锁定到兼容版本
- 建立 `src/components/ai/` 目录骨架与空 `AiSection.tsx`
- 建立 `src-tauri/src/ai/mod.rs` 骨架
- tailwind 样式隔离 PoC：在 `AiSection` 内放一个测试组件，验证 `ai-` 前缀生效且不影响 gwshell 终端、SFTP、Sidebar 样式
- **i18next 全量迁移**（决策 4）：
  1. 安装 `i18next` + `react-i18next`，新建统一 i18next 实例，注册两个 namespace：`gwshell`（默认）和 `ai`
  2. 把现有 `src/i18n/zh.ts`、`en.ts`（共 1479 行）的扁平 key 字典转换成 i18next 资源对象，仍按原 key 名保留（不重命名），作为 `gwshell` namespace
  3. cc-switch 的 i18n 资源原样搬运为 `ai` namespace（保留其原有 key 结构）
  4. 改造 `src/i18n/index.ts`：删除旧的 `getT()`，导出 i18next 实例与 `detectLocale()`
  5. 在 `App.tsx` 顶层包 `<I18nextProvider>`（虽然 react-i18next 不强制，但便于 SSR/测试）
  6. 把 12 个 consumer 文件（TerminalView、appStore、IconNav、DockerModal、NewSessionModal、NewAssetMenu、SettingsModal、以及 5 个待删的旧 AI 组件）从 `getT(locale)` 改为 `useTranslation('gwshell')`；待删组件先适配以免编译失败，后续阶段一并删除
  7. `appStore.locale` 字段保留供其它代码读取，但 `setLocale()` 改为调用 `i18next.changeLanguage(loc)` 并订阅 `languageChanged` 事件回写 store
  8. 持久化：i18next 的 language 仍走原有 gwshell store 的 localStorage 路径，不引入 i18next-browser-languagedetector

**验收**：`npm run tauri dev` 成功启动；gwshell 现有所有界面文案与切换语言行为**和原来完全一致**（regression-free）；Settings → AI 显示一个空的 cc-switch 风格面板，能正确显示 `ai` namespace 文案；切换语言时 gwshell 与 AI 区域同步切换。

---

### 阶段 1 — 数据层与 Provider 模型
**目标**：搬运 cc-switch 的数据模型与 SQLite 持久化，并完成 gwshell 旧 AI 数据的一次性迁移。

- 后端：`ai/provider.rs`、`ai/provider_defaults.rs`、`ai/store.rs`、`ai/config.rs`、`ai/app_config.rs`、`ai/app_store.rs`、`ai/database/`（schema、migration、dao、backup）
- commands：`ai/commands/provider.rs`、`ai/commands/config.rs`、`ai/commands/import_export.rs`、`ai/commands/misc.rs`
- **一次性 migration**：扫描 gwshell 现有 `ai_config.rs` / `mcp_config.rs` 持久化文件，转换成 cc-switch SQLite schema 写入 `ai.db`；在 `app_data/gwshell/migrated.flag` 写入标记避免重复迁移
- 旧 Rust 模块标记 `#[deprecated]` 但暂不删除（阶段 4/5 完成后才删）

**验收**：通过 `invoke('ai_list_providers')` 能拿到迁移后的旧 provider 数据；`ai.db` 文件正确生成；旧的 gwshell AI 配置文件未被破坏（保留作为回滚备份）。

---

### 阶段 2 — Provider UI 全套
**目标**：把 cc-switch 的 provider 管理界面 1:1 还原。

- `providers/`：ProviderList、ProviderCard、ProviderEmptyState、ProviderActions、AddProviderDialog、EditProviderDialog、HealthStatusIndicator、ProviderHealthBadge、FailoverPriorityBadge
- `providers/forms/`：ProviderForm、ProviderPresetSelector、ProviderAdvancedConfig、ApiKeyInput、EndpointSpeedTest、BasicFormFields、ClaudeFormFields、CodexFormFields、GeminiFormFields、CopilotAuthSection、OpenClawFormFields、OpenCodeFormFields、OmoFormFields、CodexConfigEditor / Sections / CommonConfigModal、GeminiConfigEditor / Sections / CommonConfigModal、CommonConfigEditor + helpers + hooks + shared
- `config/`：claudeProviderPresets、codexProviderPresets、codexTemplates、geminiProviderPresets、openclawProviderPresets、opencodeProviderPresets、universalProviderPresets、constants、iconInference
- `hooks/`：useProviderActions
- AppSwitcher 雏形：左侧切换 Claude / Codex / Gemini / Copilot / OpenClaw / OpenCode / OMO / Universal

**验收**：可在 AI 区域增删改 provider，切换不同 app 的 provider 列表，行为与 cc-switch 完全一致。

---

### 阶段 3 — AI 配置文件桥接（磁盘同步）
**目标**：让 provider 切换能真实写入 `~/.claude` / `~/.codex` / `~/.gemini` 配置文件。

- `ai/claude_mcp.rs`、`ai/claude_plugin.rs`、`ai/codex_config.rs`、`ai/gemini_config.rs`、`ai/gemini_mcp.rs`、`ai/opencode_config.rs`、`ai/openclaw_config.rs`、`ai/prompt_files.rs`
- `services/config.rs`、`services/provider/`
- 双向同步：UI 改动 → 写磁盘；磁盘外部修改 → 重新加载

**验收**：在 UI 切换 Claude provider 后，`~/.claude/settings.json` 立即更新且与 cc-switch 输出一致；外部编辑 `~/.codex/config.toml` 后 UI 刷新能反映出来。

---

### 阶段 4 — MCP / Prompts / Skills / Agents
- 前端：`mcp/UnifiedMcpPanel`、`McpFormModal`、`McpWizardModal`、`useMcpValidation`；`prompts/PromptPanel`、`PromptListItem`、`PromptToggle`、`PromptFormPanel`、`PromptFormModal`；`skills/SkillsPage`、`UnifiedSkillsPanel`、`SkillCard`、`RepoManager`、`RepoManagerPanel`；`agents/AgentsPanel`；`deeplink/McpConfirmation`、`PromptConfirmation`、`SkillConfirmation`
- 后端：`commands/mcp.rs`、`commands/prompt.rs`、`commands/skill.rs`、`commands/deeplink.rs`、`services/mcp.rs`、`services/prompt.rs`、`services/skill.rs`、`mcp/{claude,codex,gemini,opencode,validation}.rs`、`prompt.rs`、`prompt_files.rs`
- presets：`mcpPresets.ts`
- hooks：`useMcp`、`usePromptActions`、`useSkills`
- **此阶段结束后删除** gwshell 旧的 `McpManager.tsx`、`PromptsManager.tsx`、旧的 `mcp_config.rs`

**验收**：MCP 配置读写、Prompt 文件管理、Skills 仓库同步全部可用，与 cc-switch 行为一致；deeplink 导入对话框可弹出。

---

### 阶段 5 — Usage 仪表盘
- `usage/UsageDashboard`、`UsageSummaryCards`、`UsageTrendChart`、`ModelStatsTable`、`ProviderStatsTable`、`RequestLogTable`、`RequestDetailPanel`、`ModelTestConfigPanel`、`PricingConfigPanel`、`PricingEditModal`、`format.ts`
- `commands/usage.rs`、`services/usage_stats.rs`、`usage_script.rs`
- recharts 集成
- **此阶段结束后删除** gwshell 旧的 `UsageDashboard.tsx`、`usage_tracker.rs`、旧的 `ProviderEditor.tsx`、`SettingsModal.tsx` 中对应区域；至此 gwshell 旧的 AI 代码全部下线

**验收**：图表、表格、Pricing 编辑、ModelTest 全部正常；旧代码彻底移除后构建仍通过。

---

### 阶段 6 — Settings 17 面板
- `settings/`：SettingsPage（左侧导航）、AboutSection、AppVisibilitySettings、AuthCenterPanel、BackupListSection、DirectorySettings、GlobalProxySettings、ImportExportSection、LanguageSettings、LogConfigPanel、ProxyTabContent、RectifierConfigPanel、SkillSyncMethodSettings、TerminalSettings、ThemeSettings、WebdavSyncSection、WindowSettings
- `commands/settings.rs`、`commands/import_export.rs`、`commands/global_proxy.rs`
- hooks：`useSettings`、`useSettingsForm`、`useSettingsMetadata`、`useDirectorySettings`、`useGlobalProxy`、`useImportExport`、`useBackupManager`
- **i18n 完整双语补全**

**验收**：所有 17 个面板可访问、可保存配置；导入导出可双向；备份列表可管理。

---

### 阶段 7 — 反向代理 / 故障转移 / 健康检查
**风险最高的阶段**。cc-switch 自带一个完整的 axum 反向代理服务器。

- 后端 `ai/proxy/`：body_filter、cache_injector、circuit_breaker、copilot_optimizer、error、error_mapper、failover_switch、forwarder、handler_config、handler_context、handlers、health、http_client、hyper_client、log_codes、mod、model_mapper、provider_router、providers、response_handler、response_processor、server、session、sse、switch_lock、thinking_budget_rectifier、thinking_optimizer、thinking_rectifier、types、usage
- `commands/proxy.rs`、`commands/failover.rs`、`commands/stream_check.rs`、`services/proxy.rs`、`services/stream_check.rs`、`services/speedtest.rs`
- 前端 `proxy/`：ProxyPanel、ProxyToggle、AutoFailoverConfigPanel、CircuitBreakerConfigPanel、FailoverQueueManager、FailoverToggle
- 启动顺序：gwshell 主进程启动后异步拉起代理服务器；端口冲突时回退
- **可能与 gwshell 现有 socks 代理（`socks = "0.3"`）共存**，需要验证

**验收**：本地反向代理服务可启动；故障转移与健康检查工作；切换 provider 时连接不中断；端口冲突有清晰错误提示。

---

### 阶段 8 — OpenClaw / OMO / Universal / Workspace
- 前端：`openclaw/`（AgentsDefaultsPanel、EnvPanel、ToolsPanel、HealthBanner、hooks）、`universal/`（Card、Panel、FormModal）、`workspace/`（DailyMemoryPanel、WorkspaceFileEditor、WorkspaceFilesPanel）、`env/EnvWarningBanner`
- 后端：`openclaw_config.rs`、`commands/openclaw.rs`、`commands/omo.rs`、`commands/workspace.rs`、`commands/env.rs`、`services/env_checker.rs`、`services/env_manager.rs`、`services/omo.rs`
- hooks：`useOpenClaw`

**验收**：OpenClaw 三面板、OMO provider、Universal provider、Workspace 文件管理全部可用。

---

### 阶段 9 — WebDAV 同步 / 备份 / 订阅 / Auth Center / Coding Plan
- 后端：`services/webdav_sync*.rs`、`services/webdav.rs`、`services/webdav_auto_sync.rs`、`commands/webdav_sync.rs`、`commands/sync_support.rs`、`commands/subscription.rs`、`commands/auth.rs`、`commands/coding_plan.rs`、`commands/copilot.rs`、`commands/model_fetch.rs`、`services/coding_plan.rs`、`services/subscription.rs`、`services/model_fetch.rs`
- 前端：WebdavSyncSection（已在阶段 6 起骨架，此阶段补完）、AuthCenterPanel（同上）、SubscriptionQuotaFooter、UsageFooter、UsageScriptModal

**验收**：WebDAV 双向同步可用；订阅配额可显示；Auth Center 可登录第三方账号；coding plan 拉取正常。

---

### 阶段 10 — Session Manager + Deeplink + 收尾
- 后端：`session_manager/`、`commands/session_manager.rs`、`deeplink/`
- 前端：`sessions/SessionManagerPage`、`SessionItem`、`SessionMessageItem`、`SessionToc`、`AppSwitcher`、`UpdateBadge`、`DeepLinkImportDialog`
- tray 整合：把 cc-switch 托盘菜单合并进 gwshell 现有 tray
- 全量回归测试与文档更新

**验收**：Session Manager 完整可用；deeplink `cc-switch://` 协议在 gwshell 内可触发对应导入对话框；所有功能与原生 cc-switch 行为一致。

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| **React 19 vs cc-switch 旧版 React 18 依赖兼容** | 阶段 0 卡住 | 阶段 0 第一件事就做兼容性验证；如果 Radix/react-hook-form 不兼容，锁版本或暂时回退 React 18 |
| **tailwind prefix 隔离不彻底** | gwshell 终端/SFTP 视觉被破坏 | 阶段 0 PoC 验证；`corePlugins.preflight: false`；CSS Modules + scoped 容器 |
| **反向代理端口冲突 / 防火墙** | 阶段 7 不可用 | 端口可配置；启动失败有 fallback；用户可在设置中关闭代理 |
| **cc-switch 数据格式后续版本变化** | 长期维护成本 | 锁定移植时刻的 cc-switch commit hash；后续升级走人工 diff |
| **bundle 体积膨胀** | 启动变慢 | tree-shaking、按需加载（AI 区域 lazy import）、recharts/codemirror 动态加载 |
| **重复命令名冲突** | 阶段 0/1 编译失败 | 全部新命令统一加 `ai_` 前缀（除非 gwshell 不存在同名） |
| **gwshell 现有用户数据迁移失败** | 用户数据丢失 | 迁移前自动备份原文件到 `*.bak`；migration 失败自动回滚；首次迁移后弹窗提示 |
| **i18next 全量迁移破坏 gwshell 现有界面文案** | 终端/侧边栏/对话框文案丢失或回退到 key | 阶段 0 在迁移完成后做一次完整人工冒烟：每个 consumer 文件至少触发一次 UI 路径；保留旧 `zh.ts/en.ts` 作为参考直到阶段 0 验收通过；key 名保持完全一致避免漏迁 |
| **react-i18next 与 React 19 兼容** | 阶段 0 直接卡死 | 锁定 react-i18next ≥ 15（已支持 React 19）；如有问题降级到 14 + 临时类型声明 |

## 6. 验收准则（全部 10 阶段完成后）

1. gwshell `Settings → AI` 区域的所有按钮、面板、对话框、表单与 cc-switch 当前最新版**像素级一致**（对照 cc-switch 截图）
2. cc-switch 的全部数据格式（providers JSON / SQLite / `~/.claude` / `~/.codex` / `~/.gemini` 配置）gwshell 都能正确读写，且与 cc-switch 互换无副作用
3. gwshell 原有功能（SSH / SFTP / Local Shell / Serial / Docker / Session 管理 / Sidebar / TabBar / TitleBar / Terminal / 主题切换）**零回归**
4. 旧的 `ai_config.rs` / `mcp_config.rs` / `usage_tracker.rs` / 旧 `ProviderEditor.tsx` 等已删除
5. 用户旧 AI 数据已自动迁移；首次启动有迁移成功提示
6. `npm run build` 与 `npm run tauri build` 均成功；产物可在 Windows 启动并通过冒烟测试
7. 双语切换正常；所有 cc-switch 文案在 gwshell 内有完整翻译

## 7. 不在范围内（明确排除）

- **不**重构 gwshell 现有的 SSH / PTY / SFTP / Serial / Sidebar / Terminal 模块
- **不**统一 gwshell 现有 Zustand 到 react-query（react-query 仅在 AI 区域内使用）
- **不**重命名现有翻译 key（i18next 迁移时 key 名保持原样，只换调用方式）
- **不**移植 cc-switch 自带的 updater（gwshell 已有自己的 UpdateChecker）
- **不**移植 cc-switch 的 `flatpak/`、`tests/`（gwshell 没有测试基建，按 CLAUDE.md 说明也不引入）
- **不**在本任务中增加任何 cc-switch 没有的新功能

## 8. 交付物

- 本路线图（已交付）
- 10 份阶段 spec（每阶段开始前单独写）
- 10 份阶段 plan（每个 spec 通过后由 writing-plans 技能产出）
- 10 段实现 + 10 次代码评审
- 1 份最终回归测试清单（阶段 10 内）

## 9. 下一步

用户审阅本路线图 → 同意后进入**阶段 0** 的 spec 编写（基础设施铺底是最大不确定性来源，必须先单独走一遍 spec → plan → 实现）。

---

## 附录 A：cc-switch 功能盘点（侦察结果）

### 后端 Rust 模块（src-tauri/src/）
**核心**：`provider.rs`、`provider_defaults.rs`、`store.rs`、`config.rs`、`app_config.rs`、`app_store.rs`、`settings.rs`、`init_status.rs`、`lightweight.rs`、`error.rs`、`panic_hook.rs`、`tray.rs`、`auto_launch.rs`、`usage_script.rs`

**AI 配置桥接**：`claude_mcp.rs`、`claude_plugin.rs`、`codex_config.rs`、`gemini_config.rs`、`gemini_mcp.rs`、`opencode_config.rs`、`openclaw_config.rs`、`prompt.rs`、`prompt_files.rs`

**database/**：mod、schema、migration、backup、tests、dao

**commands/**（28）：auth、coding_plan、config、copilot、deeplink、env、failover、global_proxy、import_export、lightweight、mcp、misc、mod、model_fetch、omo、openclaw、plugin、prompt、provider、proxy、session_manager、settings、skill、stream_check、subscription、sync_support、usage、webdav_sync、workspace

**services/**（19）：mod、coding_plan、config、env_checker、env_manager、mcp、model_fetch、omo、prompt、provider/、proxy、skill、speedtest、stream_check、subscription、usage_stats、webdav、webdav_auto_sync、webdav_sync/、webdav_sync.rs

**proxy/**（25+）：body_filter、cache_injector、circuit_breaker、copilot_optimizer、error、error_mapper、failover_switch、forwarder、handler_config、handler_context、handlers、health、http_client、hyper_client、log_codes、mod、model_mapper、provider_router、providers/、response_handler、response_processor、server、session、sse、switch_lock、thinking_budget_rectifier、thinking_optimizer、thinking_rectifier、types、usage/

**mcp/**：claude、codex、gemini、opencode、validation、mod

**session_manager/**、**deeplink/**：完整子模块

### 前端 React 模块（src/components/）
**providers/**（10 + forms 22）
**settings/**（17 个面板）
**mcp/**（4）、**prompts/**（5）、**skills/**（5）、**agents/**（1）
**usage/**（11）、**proxy/**（6）、**openclaw/**（5+ hooks）
**universal/**（3）、**workspace/**（3）、**sessions/**（5）
**deeplink/**（3）、**env/**（1）、**common/**（4）、**ui/**（shadcn 全套）
**顶级**：AppSwitcher、SubscriptionQuotaFooter、UsageFooter、UsageScriptModal、DeepLinkImportDialog、UpdateBadge、IconPicker、ColorPicker、JsonEditor、MarkdownEditor、BrandIcons、ProviderIcon、theme-provider、mode-toggle

**config/**（10）：appConfig、claudeProviderPresets、codexProviderPresets、codexTemplates、constants、geminiProviderPresets、iconInference、mcpPresets、openclawProviderPresets、opencodeProviderPresets、universalProviderPresets

**hooks/**（19）、**lib/**（api、authBinding、clipboard、errors、platform、query、schemas、updater、utils）、**types/**（env、icon、omo、proxy、subscription、usage）、**i18n/**（双语资源）

### 关键依赖（gwshell 当前没有）
- **前端**：tailwindcss、shadcn-ui、@radix-ui/* (17)、react-hook-form、@hookform/resolvers、zod、@tanstack/react-query、framer-motion、recharts、i18next、react-i18next、sonner、cmdk、flexsearch、smol-toml、jsonc-parser、@dnd-kit/*（3）、codemirror（5 包）、@lobehub/icons-static-svg
- **后端**：axum、hyper、tower、tower-http、hyper-util、hyper-rustls、tokio-rustls、rustls、webpki-roots、rustls-native-certs、http、http-body、http-body-util、httparse、reqwest（features 升级）、toml、toml_edit、json5、json-five、indexmap、rust_decimal、sha2、zip、brotli、flate2、async-stream、bytes、futures、rquickjs、auto-launch、tauri-plugin-store、tauri-plugin-process、tauri-plugin-log、winreg(win)、objc2(macos)
