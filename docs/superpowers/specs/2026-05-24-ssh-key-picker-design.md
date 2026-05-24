# SSH 私钥认证 — 文件选择器 + 体验修复

**日期**: 2026-05-24
**状态**: 已批准

## 背景

用户反馈 SSH 密钥认证「连不上」。代码审查发现私钥路径输入框只是纯文本，
表单 placeholder 写的是 `~/.ssh/id_rsa`，但后端把 `Path::new(key_path)`
直接交给 libssh2，没有 `~` 展开 —— 照着 placeholder 输入的用户必然失败。

进一步调查发现：

1. 没有文件选择器，用户须手输完整路径
2. 后端 `ssh.rs:424` 直接 `Path::new(key_path)`，不展开 `~`
3. publickey 表单（`NewSessionModal.tsx:313-323`）只显示路径，没 passphrase 字段；但后端 `userauth_pubkey_file` 的第 4 参（passphrase）就是 `password` 形参 —— 用户没地方填
4. 跳板机（jump host）的密钥路径同样问题
5. 失败时只显示 `Public key auth failed: <libssh2 错误>`，没告知实际尝试的路径

## 目标

为 SSH 私钥认证补齐基本可用性：

- 点击 📁 按钮可弹文件选择器自动填路径
- 手动输入 `~/.ssh/id_rsa` 也能连
- 加密的私钥可输入 passphrase
- 失败时给出可定位的错误（含实际路径）

## 非目标

- **不**升级 `ssh2` crate / libssh2 native 库版本
- **不**新增 DB 字段或做迁移
- **不**改变会话导入/导出格式（仍只存路径，与 OpenSSH `IdentityFile` 习惯一致）
- **不**处理 OpenSSH 新格式密钥（`-----BEGIN OPENSSH PRIVATE KEY-----`）在 libssh2 下的兼容问题 —— 若文件能找到、passphrase 正确仍失败，由用户根据具体错误信息自行处置（如改用 `ssh-keygen -m PEM` 导出）

## 设计

### 1. 前端 UI（`src/components/Modals/NewSessionModal.tsx`）

**SSH 主认证 — publickey 分支：**

```
私钥路径  [/Users/me/.ssh/id_rsa     ] [📁]
密码短语  [••••••                    ] [👁] ← 仅 publickey 显示
```

- 路径输入框右侧加 `FolderOpen` 图标按钮（lucide-react，与 `LocalTerminalModal.tsx:250` 同款），调用：
  ```ts
  const selected = await dialogOpen({ multiple: false, title: t('ssh_select_key_file') });
  if (typeof selected === 'string' && selected) {
    setForm(prev => ({ ...prev, private_key_path: selected }));
  }
  ```
- 输入框**保留可手动编辑**（导入会话、`~` 路径、相对路径仍可工作）
- passphrase 字段**复用现有 `form.password`** —— 后端 `password` 参数本来就当作 passphrase 给 libssh2，零数据迁移；label 在 publickey 分支显示为「密码短语（可选）」并提示「仅用于解密带密码的私钥」

**跳板机 — 私钥路径：**

`NewSessionModal.tsx:681-687` 跳板机私钥输入框右侧加同款 📁 按钮，回填 `form.jump_private_key_path`。
（跳板机的 passphrase 复用 `form.jump_password`，无需新增）

### 2. i18n 新增 key

`src/i18n/locales/gwshell.{en,zh}.json` 增加：

| key | en | zh |
|---|---|---|
| `ssh_select_key_file` | Select SSH private key | 选择 SSH 私钥文件 |
| `ssh_key_passphrase_label` | Key passphrase (optional) | 密码短语（可选） |
| `ssh_key_passphrase_hint` | Only needed if your private key is encrypted | 仅用于解密带密码的私钥 |

### 3. 后端（`src-tauri/src/ssh.rs`）

**新增 helper：**

```rust
fn expand_tilde(path: &str) -> std::path::PathBuf {
    use std::path::PathBuf;
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}
```

**改动 1 — 主 SSH publickey 分支（约 line 421）：**

```rust
"publickey" => {
    let key_path_raw = private_key_path.ok_or("Private key path is required")?;
    let key_path = expand_tilde(key_path_raw);
    if !key_path.exists() {
        return Err(format!("SSH key file not found: {}", key_path.display()));
    }
    session
        .userauth_pubkey_file(username, None, &key_path, password)
        .map_err(|e| format!("Public key auth failed ({}): {}", key_path.display(), e))?;
}
```

**改动 2 — 跳板机（约 line 228）：**

```rust
if let Some(key_path_raw) = jump_private_key_path.filter(|s| !s.is_empty()) {
    let key_path = expand_tilde(key_path_raw);
    if !key_path.exists() {
        return Err(format!("Jump host key file not found: {}", key_path.display()));
    }
    jump_sess
        .userauth_pubkey_file(jump_username, None, &key_path, jump_password)
        .map_err(|e| format!("Jump key auth failed ({}): {}", key_path.display(), e))?;
}
```

### 4. 不需要修改的地方

- `src-tauri/Cargo.toml` —— `dirs` crate 已存在（`dirs = "6"`）
- `src/types/index.ts` —— 字段已存在
- `src-tauri/src/database.rs` —— 无 schema 变化
- `src-tauri/src/lib.rs` —— Tauri 命令签名不变
- `src-tauri/capabilities/*.json` —— `dialog:allow-open` 已授权

## 影响面

| 文件 | 改动幅度 |
|---|---|
| `src/components/Modals/NewSessionModal.tsx` | +20~30 行（两个 📁 按钮 + passphrase 区段）|
| `src/i18n/locales/gwshell.en.json` | +3 keys |
| `src/i18n/locales/gwshell.zh.json` | +3 keys |
| `src-tauri/src/ssh.rs` | +1 函数（~10 行）+ 两处分支改写 |

不涉及：DB 迁移、跨进程通信变更、新依赖。

## 验证

无自动化测试框架。手工核对：

1. 用 `ssh-keygen -m PEM -t rsa` 生成无密码 RSA 私钥（绕开 OpenSSH 格式兼容问题），SSH 连本机 `127.0.0.1`：
   - 点 📁 选择密钥文件 → 路径自动填入 → 连接成功
   - 手动输入 `~/.ssh/test_id_rsa` → 连接成功（验证 tilde 展开）
2. 把上述私钥路径改成不存在的文件 → 终端显示红字 `SSH key file not found: /Users/.../nonexistent`（验证错误信息含路径）
3. 用 `ssh-keygen -m PEM -t rsa -N "test123"` 生成带 passphrase 的密钥：
   - 不填密码短语 → 失败且错误信息含路径
   - 填正确 passphrase → 连接成功
4. 跳板机表单同样路径流程 ✓
5. `npm run smoke:check` 通过
6. `npm run build` 编译通过（TypeScript 类型）

## 风险

| 风险 | 处理 |
|---|---|
| OpenSSH 新格式密钥仍可能解析失败 | 已声明非目标；错误信息含路径后用户至少知道是"格式问题"而非"路径错" |
| `form.password` 在 password ↔ publickey 模式切换时残留 | 单次会话只有一个 `auth_method`，无泄漏路径；如果用户切换模式忘记清空，无安全后果，仅可能传给 libssh2 一个无效 passphrase 被忽略 |
| 文件选择器在 Linux 上需 zenity/kdialog | tauri-plugin-dialog 自身处理，已在其他模态框验证可用 |
