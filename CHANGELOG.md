# Changelog

本文件记录 GWShell 的版本变更。格式参考 [Keep a Changelog](https://keepachangelog.com/)，
版本号遵循 [语义化版本](https://semver.org/)。

发布说明由 CI（`.github/workflows/build.yml`）按标签版本号自动从本文件提取，
因此每个版本的小节标题必须形如 `## vX.Y.Z - YYYY-MM-DD`。

## v0.2.0 - 2026-05-30

### 🚀 重大修复：SSH 输入卡死（架构层面）
- 写入 / resize / 关闭命令移出 WebView 主线程（async + spawn_blocking），输入不再冻结界面
- 终端输出合并批量推送 + 流式解码 —— 解决高吞吐刷屏卡顿，以及中文 / CJK 跨读边界乱码
- 监控面板与 SFTP 改用独立 SSH 连接（建立失败时自动回退共享会话），不再与交互终端抢同一把锁导致每 ~2 秒周期性卡顿
- 终端输入按微任务合并，粘贴 / 快速输入更顺滑

### 🔒 安全与正确性
- 密码 / 跳板密码 / 代理密码 / TOTP 改为 **AES-256-GCM** 加密存储，主密钥保存在操作系统凭据库（Windows Credential Manager / macOS Keychain / Linux Secret Service）；向后兼容旧明文，首次保存自动迁移
- 导出会话文件自动脱敏，不再写入明文密码
- SFTP 大文件改为固定缓冲流式传输（修复 OOM）；编辑器保存改为「写临时文件 → 替换 → 保留权限」，中断不再清空文件
- 会话配置向前 / 向后兼容（`serde(default)`）；删除会话时正确传播数据库错误
- 退出时清理本地 shell 子进程并停止监控轮询

### 🧹 移除
- 移除应用内 Auto Mode（自动确认）—— Claude Code 已原生提供该能力。删除其监听器、规则、开关、状态指示、日志面板、存储与全部设置项

### ✅ 验证
- `cargo check` 通过；21 个后端单测全过（含 AES-GCM 加解密往返）
- 前端 `tsc + vite` 构建 + 稳定性 smoke 检查通过
- 应用可正常构建、启动并干净退出

## v0.1.0 - 2026-05-29

- 首个公开版本。
