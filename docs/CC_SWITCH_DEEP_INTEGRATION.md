# CC-Switch 深度集成方案 v2

> 上一版文档 (`CC_SWITCH_INTEGRATION.md`) 完成了「配置互通」的 MVP。  
> 本文档定义从 Phase 2 起的 **深度集成** 路线图。

---

## 当前已实现（Phase 1 ✅）

| 模块 | 状态 | 文件 |
|------|------|------|
| Rust Provider 数据模型 | ✅ | `ai_config.rs` — `AiProvider`, `ProviderApps`, `ProviderModels` |
| JSON 持久化（原子写入） | ✅ | `ai_config.rs` — `load_store()` / `save_store()` |
| Claude Code 配置写入 | ✅ | `~/.claude/settings.json` env block |
| Codex 配置写入 | ✅ | `~/.codex/config.toml` + `auth.env` |
| Gemini CLI 配置写入 | ✅ | `~/.gemini/settings.json` |
| 从 cc-switch 导入 Provider | ✅ | `import_from_cc_switch()` 读取 `~/.cc-switch/config.json` |
| 前端 Provider 编辑器 | ✅ | `ProviderEditor.tsx` — 50+ 预设、CRUD、切换 |
| Settings AI 面板 | ✅ | `SettingsModal.tsx` AI 区域 |

---

## Phase 2: OpenCode + OpenClaw 支持

CC-Switch 已支持 5 个 CLI 工具，GWShell 目前仅覆盖 3 个。

### 2.1 OpenCode 配置写入

```
~/.opencode/config.json
{
  "provider": "openai-compatible",
  "providers": {
    "openai-compatible": {
      "apiKey": "<key>",
      "model": "<model>",
      "baseURL": "<url>"
    }
  }
}
```

**Rust 实现：**
```rust
fn apply_opencode_config(provider: &AiProvider) -> Result<(), String> {
    let dir = home_dir().join(".opencode");
    fs::create_dir_all(&dir)?;
    let config = json!({
        "provider": "openai-compatible",
        "providers": {
            "openai-compatible": {
                "apiKey": provider.api_key,
                "model": provider.models.opencode.as_ref()
                    .and_then(|m| m.model.clone())
                    .unwrap_or("gpt-4o".into()),
                "baseURL": provider.base_url
            }
        }
    });
    atomic_write_text(&dir.join("config.json"), &serde_json::to_string_pretty(&config)?)
}
```

### 2.2 OpenClaw 配置写入

```
~/.openclaw/config.json
{
  "apiProvider": "custom",
  "customApiUrl": "<url>",
  "customApiKey": "<key>",
  "customModel": "<model>"
}
```

### 2.3 数据模型扩展

```rust
pub struct ProviderApps {
    pub claude: bool,
    pub codex: bool,
    pub gemini: bool,
+   pub opencode: bool,
+   pub openclaw: bool,
}
```

---

## Phase 3: MCP (Model Context Protocol) 统一管理

CC-Switch 的核心差异化功能之一。

### 3.1 目标

- 在 GWShell 中统一管理 Claude Code / Codex / Gemini CLI / OpenCode 的 MCP 服务器配置
- 双向同步：修改后自动写入各工具的配置文件
- 支持从 CC-Switch Deep Link 导入 MCP 服务器

### 3.2 MCP 配置文件位置

| 工具 | 配置位置 | 格式 |
|------|---------|------|
| Claude Code | `~/.claude/settings.json` → `mcpServers` | JSON |
| Codex | `~/.codex/config.toml` → `[mcp_servers]` | TOML |
| Gemini CLI | `~/.gemini/settings.json` → `mcpServers` | JSON |
| OpenCode | `~/.opencode/config.json` → `mcpServers` | JSON |

### 3.3 Rust 数据模型

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    /// 同步到哪些工具
    pub sync_apps: McpSyncApps,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpSyncApps {
    pub claude: bool,
    pub codex: bool,
    pub gemini: bool,
    pub opencode: bool,
}
```

### 3.4 前端组件

```
src/components/Settings/McpManager.tsx
├── MCP 服务器列表（可排序）
├── 添加/编辑 MCP 服务器
│   ├── 命令 (command)
│   ├── 参数 (args)
│   ├── 环境变量 (env)
│   └── 同步目标勾选框
├── 模板库
│   ├── filesystem
│   ├── github
│   ├── postgres
│   └── custom
└── 同步状态指示器
```

---

## Phase 4: Prompts & Skills 管理

### 4.1 Prompts（项目级指令文件）

| 工具 | 文件 |
|------|------|
| Claude Code | `CLAUDE.md` |
| Codex | `AGENTS.md` |
| Gemini CLI | `GEMINI.md` |

**功能：**
- Markdown 编辑器，支持实时预览
- 跨工具同步：编辑一个，同步到其他
- 预设模板库

### 4.2 Skills（可安装扩展）

CC-Switch 支持从 GitHub 仓库安装 Skills（通过 symlink 或文件复制）。

**GWShell 方案：**
- 浏览热门 Skills 仓库
- 一键安装到 Claude Code / Codex
- 管理已安装 Skills

---

## Phase 5: 终端内快速切换

### 5.1 状态栏集成

```
┌─ StatusBar ─────────────────────────────────┐
│ GWShell v0.1.0 │ Connected │ SSH │    AI: OpenAI GPT-4o ▼ │ 2 assets │ 14:30 │
└─────────────────────────────────────────────┘
```

点击 "AI: OpenAI GPT-4o" 弹出快速切换菜单。

### 5.2 快捷键

- `Ctrl+Shift+P` → 打开 Provider 快速切换面板
- 切换后自动写入配置文件，无需重启终端（Claude Code 支持热切换）

### 5.3 SSH 环境变量注入

连接 SSH 时，可选择自动注入 AI 相关环境变量到远程会话：

```rust
// 在 SSH 连接建立后发送
channel.exec(&format!(
    "export ANTHROPIC_API_KEY='{}' ANTHROPIC_BASE_URL='{}'",
    provider.api_key, provider.base_url
));
```

---

## Phase 6: Deep Link 协议支持

### 6.1 注册 `gwshell://` 协议

Tauri 2 Deep Link 插件：

```json
// tauri.conf.json
{
  "plugins": {
    "deep-link": {
      "desktop": {
        "schemes": ["gwshell"]
      }
    }
  }
}
```

### 6.2 支持的 Deep Link 格式

```
# 导入 Provider
gwshell://import/provider?name=MyProvider&baseUrl=https://api.example.com&apiKey=sk-xxx

# 导入 MCP Server（兼容 cc-switch 格式的 MCP 导入）
gwshell://import/mcp?name=github&command=npx&args=-y,@modelcontextprotocol/server-github

# 快速连接 SSH
gwshell://connect/ssh?host=192.168.1.1&user=root&port=22
```

### 6.3 与 CC-Switch 的 Deep Link 互操作

监听 `ccswitch://` 协议格式，自动转换并导入：

```typescript
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';

onOpenUrl((urls) => {
  for (const url of urls) {
    if (url.startsWith('ccswitch://import/provider/')) {
      importProviderFromDeepLink(url);
    } else if (url.startsWith('ccswitch://import/mcp/')) {
      importMcpFromDeepLink(url);
    }
  }
});
```

---

## Phase 7: 使用量追踪

CC-Switch 有内置的使用量追踪面板。GWShell 可以通过代理层拦截请求来统计。

### 7.1 本地代理模式

```
AI CLI Tool → localhost:proxy_port → Provider API
                    ↓
              统计 tokens / cost
```

### 7.2 Dashboard 组件

```
src/components/AI/UsageDashboard.tsx
├── 总花费趋势图
├── 按 Provider 分类
├── 按模型分类
├── 请求日志明细
└── 单价自定义设置
```

---

## 实施优先级

| 优先级 | Phase | 预期收益 |
|--------|-------|---------|
| ★★★★★ | Phase 2: OpenCode + OpenClaw | 完整 5 工具覆盖 |
| ★★★★ | Phase 5: 终端内快速切换 | 核心用户体验提升 |
| ★★★★ | Phase 3: MCP 管理 | CC-Switch 核心差异化功能 |
| ★★★ | Phase 4: Prompts & Skills | 社区生态对接 |
| ★★★ | Phase 6: Deep Link | 与 CC-Switch 互操作 |
| ★★ | Phase 7: 使用量追踪 | 成本控制可见性 |

---

## 技术依赖

| 依赖 | 用途 | 状态 |
|------|------|------|
| `tauri-plugin-deep-link` | Deep Link 协议注册 | Phase 6 需添加 |
| `toml` crate | Codex config.toml 读写 | 已通过字符串模板实现 |
| `reqwest` | 代理层 HTTP 转发 | Phase 7 需添加 |
| Markdown 渲染 | Prompts 编辑器预览 | Phase 4 需添加前端库 |

---

## 建议的下一步

**立即实施（Phase 2 + 5 的 MVP）：**

1. **扩展 ProviderApps** 加入 `opencode` / `openclaw` 字段
2. **实现 `apply_opencode_config()` 和 `apply_openclaw_config()`**
3. **在 StatusBar 显示当前活跃 Provider**
4. **添加 Provider 快速切换弹出菜单**

这四步即可让 GWShell 达到与 CC-Switch 相当的 Provider 管理能力，同时提供 CC-Switch 没有的 SSH 终端集成优势。
