# CC Switch 集成方案

## 背景

[CC Switch](https://github.com/farion1231/cc-switch)（39K+ stars, MIT）是一个 Tauri 2 + Rust + TypeScript 桌面应用，用于管理 Claude Code、Codex、Gemini CLI、OpenCode、OpenClaw 的 API 提供商配置。

**GWShell 已有 AI 设置功能**（SettingsModal 的 AI 区域）——集成 cc-switch 的目标是让 GWShell 用户无需安装独立的 cc-switch，就能在终端内直接管理 AI CLI 工具的配置。

---

## 方案对比

| 方案 | 复杂度 | 用户体验 | 维护成本 | 推荐度 |
|------|--------|---------|---------|--------|
| A. 深度集成：移植核心模块 | 高 | ★★★★★ | 高 | ⭐ |
| B. 配置互通：读写 cc-switch 配置文件 | 中 | ★★★★ | 低 | ⭐⭐⭐ 推荐 |
| C. 伴侣模式：通过 Deep Link 联动 | 低 | ★★★ | 最低 | ⭐⭐ |
| D. 嵌入 WebView | 中 | ★★★ | 中 | ⭐ |

---

## 推荐方案 B：配置文件互通 + 内置 Provider 管理

### 核心思路

1. **解析 cc-switch 的 SQLite 数据库**——cc-switch 使用 SQLite 存储 provider 配置（带原子写入）
2. **在 GWShell 中内建「AI Provider」管理面板**——复用已有的 AI 设置 UI
3. **双向兼容**——有 cc-switch 的用户自动读取其配置；没有的用户也能独立使用

### 架构图

```
┌─────────────────────────────────────────────┐
│                  GWShell                    │
│  ┌────────────┐  ┌─────────────────────┐   │
│  │ 终端/SSH/  │  │  AI Provider 管理   │   │
│  │ SFTP 功能  │  │  ┌───────────────┐  │   │
│  │            │  │  │ 内置 Provider │  │   │
│  │            │  │  │ 预设(50+)     │  │   │
│  │            │  │  ├───────────────┤  │   │
│  │    ┌──────┐│  │  │ 配置读写层   │  │   │
│  │    │AI 助 ││  │  │ (SQLite/JSON)│  │   │
│  │    │手集成││◄─┤  └──────┬────────┘  │   │
│  │    └──────┘│  │         │           │   │
│  └────────────┘  └─────────┼───────────┘   │
│                            │               │
│  ┌─────────────────────────▼─────────────┐ │
│  │      Config Adapter (Rust)            │ │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐│ │
│  │  │Claude    │ │Codex     │ │Gemini  ││ │
│  │  │Code JSON │ │.env/TOML │ │CLI JSON││ │
│  │  └──────────┘ └──────────┘ └────────┘│ │
│  └───────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
         ▲                    ▲
         │ 共享同一配置文件    │ Deep Link 导入
    ┌────┴────┐          ccswitch://
    │CC Switch│          (可选联动)
    │(若已安装)│
    └─────────┘
```

### 实施步骤

#### 第一阶段：配置读写层（Rust 后端）

**1. 在 Cargo.toml 添加依赖：**
```toml
[dependencies]
rusqlite = { version = "0.33", features = ["bundled"] }  # SQLite
```

**2. 创建 `src-tauri/src/ai_config.rs`：**

```rust
// 核心数据结构 — 与 cc-switch 配置兼容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiProvider {
    pub id: String,
    pub name: String,
    pub provider_type: String,     // "claude_code" | "codex" | "gemini_cli" | "opencode" | "openclaw"
    pub base_url: String,
    pub api_key: String,
    pub model: Option<String>,
    pub enabled: bool,
    pub custom_headers: Option<HashMap<String, String>>,
}

// 读取 cc-switch 的 SQLite 数据库
fn cc_switch_db_path() -> Option<PathBuf> {
    // cc-switch 默认数据目录
    // Windows: %APPDATA%/cc-switch/
    // macOS:   ~/Library/Application Support/cc-switch/
    // Linux:   ~/.config/cc-switch/
    dirs::config_dir().map(|d| d.join("cc-switch").join("cc-switch.db"))
}

// GWShell 自己的 provider 存储
fn gwshell_providers_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("gwshell").join("ai_providers.json"))
}

#[tauri::command]
pub fn list_ai_providers() -> Result<Vec<AiProvider>, String> {
    // 优先从 cc-switch DB 读取（若安装）
    // 否则从 GWShell 自己的 JSON 加载
}

#[tauri::command]
pub fn save_ai_provider(provider: AiProvider) -> Result<(), String> { ... }

#[tauri::command]
pub fn switch_ai_provider(provider_id: &str, tool: &str) -> Result<(), String> {
    // 将 provider 配置写入对应CLI工具的配置文件：
    // Claude Code: ~/.claude.json -> apiUrl, apiKey, model
    // Codex:       ~/.codex/.env  -> OPENAI_BASE_URL, OPENAI_API_KEY
    // Gemini CLI:  ~/.gemini/settings.json
}
```

#### 第二阶段：前端 Provider 管理面板

**在 SettingsModal 的 AI 区域扩展：**

```tsx
// 新增 Provider 列表 + 快速切换
<SectionTitle>{t('settings_ai_providers')}</SectionTitle>
<Row label={t('settings_ai_active_provider')}>
  <Sel value={activeProvider} onChange={switchProvider}>
    {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
  </Sel>
</Row>
<button onClick={openProviderEditor}>{t('settings_ai_manage_providers')}</button>

// Provider 编辑面板（弹窗或内联）
<ProviderEditor
  providers={providers}
  onSave={saveProvider}
  onDelete={deleteProvider}
  presets={AI_PRESETS}         // 内置 50+ 预设
/>
```

**内置预设示例：**
```typescript
const AI_PRESETS = [
  { name: 'OpenAI Official', baseUrl: 'https://api.openai.com/v1', type: 'codex' },
  { name: 'Anthropic Official', baseUrl: 'https://api.anthropic.com', type: 'claude_code' },
  { name: 'Google AI Studio', baseUrl: 'https://generativelanguage.googleapis.com', type: 'gemini_cli' },
  // ... 50+ 社区中继预设
];
```

#### 第三阶段：终端内 AI 助手集成

```
┌─ GWShell Terminal ──────────────────────────┐
│ $ claude "explain this code"                │
│ Using provider: OpenAI GPT-4 (via proxy)    │
│ ...                                         │
│                                             │
│ [Ctrl+Shift+P] Quick Switch Provider ▼      │
│  ┌────────────────────────┐                 │
│  │ ● OpenAI GPT-4o       │                 │
│  │ ○ Anthropic Claude    │                 │
│  │ ○ Google Gemini       │                 │
│  │ ○ 自定义 API          │                 │
│  └────────────────────────┘                 │
└─────────────────────────────────────────────┘
```

- 在终端底部状态栏显示当前 AI 提供商
- 快捷键切换提供商（无需打开设置）
- 自动在 SSH 会话中注入环境变量

#### 第四阶段：cc-switch Deep Link 互通（可选）

```typescript
// 监听 ccswitch:// 协议导入
// Tauri 2 Deep Link 注册
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';

onOpenUrl((urls) => {
  for (const url of urls) {
    if (url.startsWith('ccswitch://import/provider/')) {
      // 解析并导入 provider 配置
      importProviderFromDeepLink(url);
    }
  }
});
```

---

## 工作量估算

| 阶段 | 内容 | 涉及文件 |
|------|------|---------|
| 阶段一 | Rust 配置读写层 | `ai_config.rs`, `Cargo.toml`, `main.rs` |
| 阶段二 | 前端 Provider UI | `SettingsModal.tsx`, 新组件 `ProviderEditor.tsx` |
| 阶段三 | 终端内快速切换 | `StatusBar.tsx`, `TerminalView.tsx` |
| 阶段四 | Deep Link 互通 | `tauri.conf.json`, `main.rs`, 前端监听 |

---

## 关键注意事项

1. **API Key 安全**：使用 Tauri 2 的 Stronghold 或系统 Keychain 存储密钥，不要明文写 JSON
2. **配置冲突**：如果用户同时运行 cc-switch 和 GWShell，需要文件锁或使用 cc-switch 的 SQLite（自带原子写入）
3. **MIT 许可**：cc-switch 是 MIT 协议，可以自由参考其代码和预设数据
4. **版本兼容**：cc-switch 当前 v3.12.3，数据库 schema 可能随版本变化，需要做好版本检测

---

## 建议的起步方式

**最小可行方案（MVP）：先实现阶段一 + 阶段二的基础部分**

1. 添加 `rusqlite` 依赖
2. 创建 `ai_config.rs` 实现 JSON 格式的 provider 存储
3. 在 SettingsModal 添加 provider 列表 + 切换功能
4. 实现 Claude Code JSON 和 Codex .env 的配置写入

这样 GWShell 用户就能直接在一个应用内管理 AI CLI 工具的配置切换，而不需要安装独立的 cc-switch。
