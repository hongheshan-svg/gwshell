# SSH Key Picker + Auth Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 SSH/跳板机私钥认证补上文件选择器、`~` 路径展开、passphrase 输入框，以及带路径信息的错误提示。

**Architecture:** 复用 `tauri-plugin-dialog`（已接入）做文件选择器；后端加纯函数 `expand_tilde` 并在两处 `userauth_pubkey_file` 之前调用 + 文件存在性预检；前端复用 `.ssh-password-wrap` CSS 模式塞入 FolderOpen 按钮；passphrase 复用现有 `form.password`，零数据库迁移。

**Tech Stack:** Rust + ssh2 0.9 + libssh2; React + TS + Tauri 2 + tauri-plugin-dialog; lucide-react 图标

**Spec:** `docs/superpowers/specs/2026-05-24-ssh-key-picker-design.md`

---

## File Structure

| 文件 | 责任 | 操作 |
|---|---|---|
| `src-tauri/src/ssh.rs` | `expand_tilde` 纯函数 + 主 SSH publickey 分支 + 跳板机 publickey 分支 + 单元测试 | Modify |
| `src/i18n/locales/gwshell.en.json` | 3 个新 i18n key | Modify |
| `src/i18n/locales/gwshell.zh.json` | 3 个新 i18n key | Modify |
| `src/i18n/index.ts` | 如使用 `TranslationKeys` 类型补充新 key | Modify(可能) |
| `src/components/Modals/NewSessionModal.tsx` | 主私钥路径加 📁 按钮、加 passphrase 输入框、跳板机私钥路径加 📁 按钮 | Modify |

无新增文件，无新增依赖（`tauri-plugin-dialog`、`@tauri-apps/plugin-dialog`、`lucide-react`、`dirs` crate 全部已在）。

---

## Task 1: 后端 — `expand_tilde` 纯函数（TDD）

**Files:**
- Modify: `src-tauri/src/ssh.rs`（在文件末尾追加 `#[cfg(test)] mod tests` 模块；helper 函数加在 `impl SshManager` 之前或 use 块附近）

**Why TDD here:** `expand_tilde` 是无副作用的纯函数；项目里已有 `src-tauri/src/metrics.rs:297` 用 `#[cfg(test)] mod tests` 写单元测试的先例，跟仓库一致。

- [ ] **Step 1: 写失败的单元测试**

在 `src-tauri/src/ssh.rs` 文件**最末尾**追加：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn expand_tilde_leaves_absolute_path_unchanged() {
        assert_eq!(expand_tilde("/etc/ssh/id_rsa"), PathBuf::from("/etc/ssh/id_rsa"));
    }

    #[test]
    fn expand_tilde_leaves_relative_path_unchanged() {
        assert_eq!(expand_tilde(".ssh/id_rsa"), PathBuf::from(".ssh/id_rsa"));
    }

    #[test]
    fn expand_tilde_expands_bare_tilde() {
        let home = dirs::home_dir().expect("test env should have home dir");
        assert_eq!(expand_tilde("~"), home);
    }

    #[test]
    fn expand_tilde_expands_tilde_slash_prefix() {
        let home = dirs::home_dir().expect("test env should have home dir");
        assert_eq!(expand_tilde("~/.ssh/id_rsa"), home.join(".ssh/id_rsa"));
    }

    #[test]
    fn expand_tilde_does_not_expand_user_specific_tilde() {
        // ~root/foo 这种 OpenSSH 不常用、libssh2 也不支持，我们按字面处理
        assert_eq!(expand_tilde("~root/foo"), PathBuf::from("~root/foo"));
    }
}
```

- [ ] **Step 2: 跑测试确认编译失败**

```bash
cd /Users/zhengshan/projects/gwshell/src-tauri && cargo test --lib expand_tilde 2>&1 | tail -10
```
Expected: 编译失败，错误信息包含 `cannot find function expand_tilde in this scope` 或类似。

- [ ] **Step 3: 实现 `expand_tilde`**

在 `src-tauri/src/ssh.rs` 中找到 `pub fn trust_host` 上方（约 line 48 之前），插入：

```rust
/// Expand a leading `~` or `~/` into the user's home directory.
/// Other forms (`~user/...`) are returned unchanged — libssh2 doesn't
/// support them either, so we keep behavior predictable.
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

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/zhengshan/projects/gwshell/src-tauri && cargo test --lib expand_tilde 2>&1 | tail -10
```
Expected: `test result: ok. 5 passed; 0 failed`

- [ ] **Step 5: Commit**

```bash
cd /Users/zhengshan/projects/gwshell && \
git add src-tauri/src/ssh.rs && \
git commit -m "feat(ssh): add expand_tilde helper with unit tests

Pure function that expands leading ~ / ~/ to the user's home directory.
Other shell tilde forms (~user/...) pass through unchanged, matching
libssh2 behavior.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 后端 — 把 `expand_tilde` + 存在性预检 + 错误信息接到两处 publickey 分支

**Files:**
- Modify: `src-tauri/src/ssh.rs:228-231`（跳板机 publickey 分支，函数 `tcp_via_jump` 内）
- Modify: `src-tauri/src/ssh.rs:421-426`（主 SSH publickey 分支，`SshManager::connect` 内）

- [ ] **Step 1: 改写主 SSH publickey 分支**

在 `src-tauri/src/ssh.rs` 找到 `"publickey" =>` 分支（约 line 421-426）：

```rust
            "publickey" => {
                let key_path = private_key_path.ok_or("Private key path is required")?;
                session
                    .userauth_pubkey_file(username, None, Path::new(key_path), password)
                    .map_err(|e| format!("Public key auth failed: {}", e))?;
            }
```

替换为：

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

- [ ] **Step 2: 改写跳板机 publickey 分支**

在 `src-tauri/src/ssh.rs` 找到 `if let Some(key_path) = jump_private_key_path.filter` 块（约 line 228-231）：

```rust
    if let Some(key_path) = jump_private_key_path.filter(|s| !s.is_empty()) {
        jump_sess
            .userauth_pubkey_file(jump_username, None, Path::new(key_path), jump_password)
            .map_err(|e| format!("Jump key auth failed: {}", e))?;
    } else if let Some(pwd) = jump_password.filter(|s| !s.is_empty()) {
```

替换为：

```rust
    if let Some(key_path_raw) = jump_private_key_path.filter(|s| !s.is_empty()) {
        let key_path = expand_tilde(key_path_raw);
        if !key_path.exists() {
            return Err(format!("Jump host key file not found: {}", key_path.display()));
        }
        jump_sess
            .userauth_pubkey_file(jump_username, None, &key_path, jump_password)
            .map_err(|e| format!("Jump key auth failed ({}): {}", key_path.display(), e))?;
    } else if let Some(pwd) = jump_password.filter(|s| !s.is_empty()) {
```

- [ ] **Step 3: 编译验证**

```bash
cd /Users/zhengshan/projects/gwshell/src-tauri && cargo build 2>&1 | tail -15
```
Expected: `Finished \`dev\` profile [unoptimized + debuginfo] target(s) in ...` 无 warning 或仅有原有 warning（不应新增）。

- [ ] **Step 4: 跑现有测试确认未回归**

```bash
cd /Users/zhengshan/projects/gwshell/src-tauri && cargo test --lib 2>&1 | tail -10
```
Expected: 所有测试通过（含 Task 1 的 5 个 expand_tilde 测试 + metrics.rs 既有测试）。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhengshan/projects/gwshell && \
git add src-tauri/src/ssh.rs && \
git commit -m "fix(ssh): expand ~ in key paths, pre-check existence, include path in errors

Both the main SSH publickey branch and the jump host's publickey branch
now run the user-supplied key path through expand_tilde, then verify
the file exists before handing it to libssh2. Failure messages include
the actual (expanded) path so users can tell apart 'file not found'
from 'libssh2 cannot parse this key'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: i18n — 新增 3 个 key（en + zh）

**Files:**
- Modify: `src/i18n/locales/gwshell.en.json`
- Modify: `src/i18n/locales/gwshell.zh.json`
- Modify (如果存在): `src/i18n/index.ts` (TranslationKeys 类型)

- [ ] **Step 1: 检查 TranslationKeys 是否需要手动同步**

```bash
cd /Users/zhengshan/projects/gwshell && grep -n "TranslationKeys" src/i18n/index.ts 2>/dev/null | head -5
```
Expected: 看到 `TranslationKeys` 是怎么定义的。
- 如果是 `keyof typeof enJson` 之类自动推导 → 不需要手动改 `index.ts`
- 如果是手写联合类型 → Step 3 需要手动加 3 个 key

- [ ] **Step 2: 编辑 `src/i18n/locales/gwshell.en.json`**

在 `"ssh_private_key_path": "Private Key Path",` 这一行（约 line 93）之后追加 3 行：

```json
  "ssh_private_key_path": "Private Key Path",
  "ssh_select_key_file": "Select SSH private key",
  "ssh_key_passphrase_label": "Key passphrase (optional)",
  "ssh_key_passphrase_hint": "Only needed if your private key is encrypted",
```

（保持原 `"ssh_private_key_path"` 行不变，紧随其后插入新 3 行，确保末尾逗号语法正确。）

- [ ] **Step 3: 编辑 `src/i18n/locales/gwshell.zh.json`**

在 `"ssh_private_key_path": "私钥路径",`（约 line 93）之后追加：

```json
  "ssh_private_key_path": "私钥路径",
  "ssh_select_key_file": "选择 SSH 私钥文件",
  "ssh_key_passphrase_label": "密码短语（可选）",
  "ssh_key_passphrase_hint": "仅在私钥设了密码时需要填写",
```

- [ ] **Step 4: 如果 Step 1 显示 `TranslationKeys` 是手写联合类型，同步加入 3 个 key**

只在 Step 1 输出表明需要时执行。打开 `src/i18n/index.ts`，找到 `TranslationKeys` 类型定义，在其它 `ssh_*` key 旁加：
```ts
| 'ssh_select_key_file'
| 'ssh_key_passphrase_label'
| 'ssh_key_passphrase_hint'
```

- [ ] **Step 5: 跑 TypeScript 检查**

```bash
cd /Users/zhengshan/projects/gwshell && npm run build 2>&1 | tail -20
```
Expected: `vite build` 完成，无 TS 错误。如果报 `Property '...' does not exist on type 'TranslationKeys'` 之类错，回到 Step 4 补类型。

- [ ] **Step 6: Commit**

```bash
cd /Users/zhengshan/projects/gwshell && \
git add src/i18n/ && \
git commit -m "i18n: add keys for SSH key file picker and passphrase

ssh_select_key_file        - file picker dialog title
ssh_key_passphrase_label   - passphrase input label
ssh_key_passphrase_hint    - passphrase input helper text

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 前端 — 文件选择器 + passphrase 字段（NewSessionModal）

**Files:**
- Modify: `src/components/Modals/NewSessionModal.tsx`
  - line 3: import 增加 `FolderOpen` 图标 + `dialogOpen`
  - line 313-323: 主私钥路径输入加 📁 按钮 + 紧接其后追加 passphrase 字段
  - line 680-688: 跳板机私钥路径输入加 📁 按钮

CSS 复用 `.ssh-password-wrap` + `.ssh-password-toggle`（`src/styles/global.css:2478-2506`），它们就是「输入框 + 绝对定位右侧按钮」的通用容器，FolderOpen 按钮可以直接用同样的 className。

- [ ] **Step 1: 加 import**

在 `src/components/Modals/NewSessionModal.tsx` 文件顶部找到：

```tsx
import { X, Eye, EyeOff } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
```

替换为：

```tsx
import { X, Eye, EyeOff, FolderOpen } from 'lucide-react';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../../stores/appStore';
```

- [ ] **Step 2: 加文件选择回调（放在组件函数体内、`return (` 之前）**

在 `src/components/Modals/NewSessionModal.tsx` 找到组件函数体里现有的事件处理（任意位置，比如靠近 `const handleSave = ...` 或在 `const t = ...` 之后）。如果不确定位置，放在 `return (` 上面一行。插入：

```tsx
  const pickKeyFile = async (field: 'private_key_path' | 'jump_private_key_path') => {
    try {
      const selected = await dialogOpen({ multiple: false, title: t('ssh_select_key_file') });
      if (typeof selected === 'string' && selected) {
        setForm((prev) => ({ ...prev, [field]: selected }));
      }
    } catch { /* canceled */ }
  };
```

- [ ] **Step 3: 改写主私钥路径区段（line 313-323）**

找到：

```tsx
              {/* Private key */}
              {form.auth_method === 'publickey' && (
                <div className="ssh-form-group">
                  <label>{t('ssh_private_key_path')}</label>
                  <input
                    type="text"
                    placeholder="~/.ssh/id_rsa"
                    value={form.private_key_path || ''}
                    onChange={(e) => setForm({ ...form, private_key_path: e.target.value })}
                  />
                </div>
              )}
```

替换为：

```tsx
              {/* Private key */}
              {form.auth_method === 'publickey' && (
                <>
                  <div className="ssh-form-group">
                    <label>{t('ssh_private_key_path')}</label>
                    <div className="ssh-password-wrap">
                      <input
                        type="text"
                        placeholder="~/.ssh/id_rsa"
                        value={form.private_key_path || ''}
                        onChange={(e) => setForm({ ...form, private_key_path: e.target.value })}
                      />
                      <button
                        type="button"
                        className="ssh-password-toggle"
                        title={t('ssh_select_key_file')}
                        onClick={() => pickKeyFile('private_key_path')}
                      >
                        <FolderOpen size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="ssh-form-group">
                    <label>{t('ssh_key_passphrase_label')}</label>
                    <div className="ssh-password-wrap">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder=""
                        value={form.password || ''}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                      />
                      <button
                        className="ssh-password-toggle"
                        onClick={() => setShowPassword(!showPassword)}
                        type="button"
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <div className="ssh-tab-desc" style={{ marginTop: 4 }}>
                      {t('ssh_key_passphrase_hint')}
                    </div>
                  </div>
                </>
              )}
```

- [ ] **Step 4: 改写跳板机私钥路径区段（line 680-688）**

找到：

```tsx
                  <div className="ssh-form-group">
                    <label>{t('ssh_jump_key_path')}</label>
                    <input
                      type="text"
                      placeholder="~/.ssh/id_rsa"
                      value={form.jump_private_key_path || ''}
                      onChange={(e) => setForm({ ...form, jump_private_key_path: e.target.value })}
                    />
                  </div>
```

替换为：

```tsx
                  <div className="ssh-form-group">
                    <label>{t('ssh_jump_key_path')}</label>
                    <div className="ssh-password-wrap">
                      <input
                        type="text"
                        placeholder="~/.ssh/id_rsa"
                        value={form.jump_private_key_path || ''}
                        onChange={(e) => setForm({ ...form, jump_private_key_path: e.target.value })}
                      />
                      <button
                        type="button"
                        className="ssh-password-toggle"
                        title={t('ssh_select_key_file')}
                        onClick={() => pickKeyFile('jump_private_key_path')}
                      >
                        <FolderOpen size={14} />
                      </button>
                    </div>
                  </div>
```

- [ ] **Step 5: TypeScript + Smoke 检查**

```bash
cd /Users/zhengshan/projects/gwshell && npm run build 2>&1 | tail -20 && npm run smoke:check 2>&1 | tail -20
```
Expected:
- `npm run build`: `vite v... building for production... ✓ built in ...` 无 TS 错。
- `npm run smoke:check`: 输出收尾出现 `OK` / `passed` / `0 issues` 之类无问题字样（具体看 `scripts/stability-smoke.mjs` 的输出格式；只要返回码 0 即可）。

- [ ] **Step 6: Commit**

```bash
cd /Users/zhengshan/projects/gwshell && \
git add src/components/Modals/NewSessionModal.tsx && \
git commit -m "feat(ui): add file picker + passphrase field to SSH key auth

- Click the folder icon next to 'Private Key Path' to pick a key file
  via the OS dialog (also applies to the jump host's key field).
- When publickey auth is selected, the password field doubles as the
  key passphrase (reuses form.password, no schema change required) and
  is now shown with a helper hint.
- Manual text input still works; the backend handles ~ expansion.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 端到端手动验证

**Files:** 无（这步是 dev 运行 + 真机测试）

参考 spec 「验证」章节。运行 dev 模式：

```bash
cd /Users/zhengshan/projects/gwshell && npm run tauri dev
```

(应用启动后，新开终端窗口执行验证步骤。)

- [ ] **Step 1: 准备测试用 SSH 密钥**

```bash
# 生成无密码 PEM 格式 RSA key（绕开 OpenSSH 新格式兼容问题）
ssh-keygen -m PEM -t rsa -b 2048 -N "" -f ~/.ssh/gwshell_test_id_rsa <<< y

# 生成带 passphrase 的 PEM 格式 key
ssh-keygen -m PEM -t rsa -b 2048 -N "testpass123" -f ~/.ssh/gwshell_test_id_rsa_pass <<< y

# 把公钥加到本机 authorized_keys（macOS 须先在系统偏好打开 Remote Login）
cat ~/.ssh/gwshell_test_id_rsa.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/gwshell_test_id_rsa_pass.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# 验证 OpenSSH 自身能用
ssh -i ~/.ssh/gwshell_test_id_rsa -o StrictHostKeyChecking=no $(whoami)@127.0.0.1 echo OK
```
Expected: 最后一行输出 `OK`。

- [ ] **Step 2: 验证文件选择器 + 绝对路径（happy path）**

在 GWShell 中新建一个 SSH 会话：
- Host: `127.0.0.1`，Port: `22`，Username: 当前用户名
- Auth: `Private Key`
- 点击 📁 按钮 → 选择 `~/.ssh/gwshell_test_id_rsa`
  - **Expected**: 输入框自动填入完整绝对路径（如 `/Users/zhengshan/.ssh/gwshell_test_id_rsa`）
- 留 passphrase 空白，连接

**Expected:** 终端显示连接进度并出现 shell 提示符。

- [ ] **Step 3: 验证 `~` 展开（手动输入）**

新建另一个会话，手动在路径框输入 `~/.ssh/gwshell_test_id_rsa`，passphrase 留空，连接。

**Expected:** 连接成功（证明后端展开了 `~`）。

- [ ] **Step 4: 验证文件不存在的错误信息**

新建会话，手动输入 `~/.ssh/this_does_not_exist`，连接。

**Expected:** 终端显示红字 `SSH key file not found: /Users/.../.ssh/this_does_not_exist`（路径已展开）。

- [ ] **Step 5: 验证 passphrase**

新建会话，📁 选择 `~/.ssh/gwshell_test_id_rsa_pass`：
- 5a) 留 passphrase 空白 → **Expected:** 红字 `Public key auth failed (/Users/.../gwshell_test_id_rsa_pass): ...`（错误信息含路径）
- 5b) 在 passphrase 框输入 `testpass123` → **Expected:** 连接成功

- [ ] **Step 6: 验证跳板机表单**

如果手头有可用的跳板机环境，重复上述 Step 2-5 验证跳板机的 📁 按钮和路径处理；否则**至少**在新建会话时切到 "via jump host"，确认跳板机私钥路径输入框右侧出现 📁 按钮，点击能弹文件选择器（不必真连接）。

- [ ] **Step 7: 清理测试密钥**

```bash
# 从 authorized_keys 移除测试用 key
grep -v gwshell_test ~/.ssh/authorized_keys > /tmp/ak.new && mv /tmp/ak.new ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
rm -f ~/.ssh/gwshell_test_id_rsa ~/.ssh/gwshell_test_id_rsa.pub ~/.ssh/gwshell_test_id_rsa_pass ~/.ssh/gwshell_test_id_rsa_pass.pub
```

- [ ] **Step 8: 在 GWShell 中删除测试会话**

回到 GWShell 把这次创建的临时测试会话从侧边栏删掉，避免遗留无效配置。

无 commit（这步只验证，不产生代码变更）。

---

## Self-Review

**Spec coverage:**
- ✅ 文件选择器 → Task 4 Step 3 + Step 4
- ✅ Passphrase 字段（复用 form.password）→ Task 4 Step 3
- ✅ 跳板机同步加 📁 → Task 4 Step 4
- ✅ 后端 `~` 展开 → Task 1 + Task 2
- ✅ 文件存在性预检 + 错误信息含路径 → Task 2 Step 1, Step 2
- ✅ i18n 3 个 key → Task 3
- ✅ 验证步骤覆盖 spec 列的 4 个手动 case → Task 5
- ✅ `npm run smoke:check` → Task 4 Step 5
- ✅ `npm run build` → Task 4 Step 5

**Type / 名称一致性：**
- `expand_tilde` 函数签名（`fn expand_tilde(path: &str) -> std::path::PathBuf`）在 Task 1 定义、Task 2 两处调用、Task 1 测试均一致。
- i18n key 名称 `ssh_select_key_file` / `ssh_key_passphrase_label` / `ssh_key_passphrase_hint` 在 Task 3 定义、Task 4 引用全部对得上。
- `pickKeyFile` 形参签名 `'private_key_path' | 'jump_private_key_path'` 在 Task 4 Step 2 定义、Step 3/4 调用一致。

**Placeholder 扫描：** 全 plan 无 TBD/TODO，无 "适当处理" 之类模糊词；每个修改步骤都给出完整替换代码块。

**风险点确认：**
- Task 3 Step 1 用条件分支处理 `TranslationKeys` 可能是自动推导也可能是手写 —— 这是真实的项目变体，不是占位符。
