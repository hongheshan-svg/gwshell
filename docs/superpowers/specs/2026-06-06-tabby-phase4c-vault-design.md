# Phase 4c 设计:主密码保险库(安全防御层,无锁死)

- 2026-06-06 · Rust(argon2)+ 前端 · **cargo 验编译;解锁 UX 用户自测**
- 用户决策:**防御层**——主密码作"应用解锁门",验证哈希;**不动 keyring 主键与 enc:v1: 加密** → 忘密码绝不丢凭据。

## 关键安全约束(实现必须遵守)
- **绝不修改** `crypto.rs` 的 `master_key()`/keyring 逻辑、`enc:v1:` 秘密加密。秘密仍由 keyring 主键加解密(无锁死)。
- 主密码**只存 Argon2id 哈希(PHC 串)**,绝不存明文;绝不记录明文到日志/错误。
- 保险库 = **应用访问门**:启用且未解锁时,前端整屏遮挡,直到主密码校验通过。这是 UX/防御层(非密码学密钥隔离;keyring 仍持密钥)。已与用户确认。
- 忘密码可"重置保险库"(禁用门);凭据不丢(keyring 未动)。

## 设计
1. **依赖**:`Cargo.toml` 加 `argon2 = "0.5"`。
2. **`vault.rs`**:`set_passphrase(db, &str)`(Argon2id 哈希→存)、`verify(db, &str)->bool`、`clear(db)`、`is_enabled(db)->bool`(验证串是否存在)。验证串存 `app_settings` 表 key=`'vault_verifier'`(加 Database 方法 `set_vault_verifier`/`get_vault_verifier`/`clear_vault_verifier`,复用 key/value 表,不新建表;不碰现有 key='main' 包装)。
3. **IPC**(lib.rs + 注册):`vault_set_passphrase(passphrase)`、`vault_verify(passphrase)->bool`、`vault_clear(current_passphrase)->bool`(先 verify 再 clear)、`vault_is_enabled()->bool`。
4. **前端**:
   - `appStore`:`vaultLocked: boolean`(默认 false)、`setVaultLocked`。启动时调 `vault_is_enabled`;若启用→`setVaultLocked(true)`。
   - `UnlockScreen.tsx`:`vaultLocked` 为真时整屏遮挡(fixed, 最高 z-index),一个密码输入 + 解锁;`vault_verify` 成功→`setVaultLocked(false)`;失败→错误提示。无"取消"(必须解锁)。
   - App.tsx:启动 effect 查 enabled;根部渲染 `{vaultLocked && <UnlockScreen/>}`(置于所有内容之上)。
   - SettingsModal:保险库区——启用(设主密码,两次确认)、修改(验旧设新)、禁用(验当前)。调对应 IPC。i18n。
5. **不做**(v1):idle 自动上锁、密码强度计、passphrase-only 模式。

## 边界
- argon2 默认参数(Argon2id 合理 cost)。verify 用 argon2 的 `verify_password`(内部抗时序)。
- 启用但 keyring 不可用时:保险库门仍工作(独立于 keyring);秘密照旧明文降级(既有行为)。
- 解锁前不连接、不泄露会话(整屏遮挡即可;v1 不强制清空 store)。

## 测试
`cargo check` 必过(拉 argon2)。运行时(用户):设主密码→重启→出现解锁屏→对/错密码;改密码;禁用;忘密码后重置仍能用(凭据未丢)。

## 落点
新增 `src-tauri/src/vault.rs`、`src/components/UnlockScreen.tsx`。改 `Cargo.toml`、`lib.rs`(IPC+注册+mod vault)、`database.rs`(verifier 读写方法)、`appStore.ts`、`App.tsx`、`SettingsModal.tsx`(两处 AppSettings 若加 vaultEnabled 标志—或仅靠后端 is_enabled,不必加 setting 字段)、i18n。
