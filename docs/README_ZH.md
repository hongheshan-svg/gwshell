<div align="center">

# 🐚 GWShell

**现代化跨平台 SSH / 终端管理工具**

[![构建与发布](https://github.com/hongheshan-svg/gwshell/actions/workflows/build.yml/badge.svg)](https://github.com/hongheshan-svg/gwshell/actions)
[![GitHub Release](https://img.shields.io/github/v/release/hongheshan-svg/gwshell?include_prereleases)](https://github.com/hongheshan-svg/gwshell/releases)
[![License](https://img.shields.io/github/license/hongheshan-svg/gwshell)](../LICENSE)

[English](../README.md) | **简体中文** | [日本語](README_JA.md) | [한국어](README_KO.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Deutsch](README_DE.md) | [Русский](README_RU.md)

<img src="screenshot.png" width="800" alt="GWShell 截图" />

</div>

---

## ✨ 功能特性

### 已实现 ✅

| 分类 | 功能 | 说明 |
|------|------|------|
| **SSH** | 多标签 SSH 连接 | 同时连接多台服务器，独立标签页 |
| **SSH** | 密码 / 密钥 / MFA 认证 | 支持密码、私钥、键盘交互（TOTP/2FA）认证 |
| **SSH** | SSH Agent 转发 | 使用系统 SSH Agent（OpenSSH / Pageant） |
| **SSH** | 跳板机 (-J) | 通过堡垒机/跳板机代理连接 |
| **SSH** | SOCKS4/5, HTTP 代理 | 通过代理服务器路由 SSH 连接 |
| **SSH** | 端口转发 | 本地端口转发（SSH 隧道） |
| **SSH** | 连接延迟 (ping) | 实时 TCP 延迟检测 |
| **SFTP** | 文件浏览器 | 树形面板浏览远程文件系统 |
| **SFTP** | 上传 / 下载 | 本地与远程之间传输文件 |
| **SFTP** | 在线文本编辑器 | 直接编辑远程文件，支持行号显示 |
| **SFTP** | 权限管理 (chmod) | 修改远程文件权限 |
| **SFTP** | 重命名 / 删除 / 新建目录 | 完整文件管理操作 |
| **终端** | 本地终端 | 打开本地 Shell（PowerShell、CMD、Bash、Zsh 等） |
| **终端** | 分屏 | 1×1、1×2、2×2、2×3、2×4 分屏布局 |
| **终端** | xterm.js 渲染 | GPU 加速终端，支持链接点击、文本选择 |
| **终端** | 主题同步 | 终端颜色跟随应用亮/暗主题 |
| **串口** | 串口控制台 | 连接 COM/ttyUSB 设备，配置波特率 |
| **Docker** | Docker 管理 | 通过 SSH 隧道连接 Docker 主机（开发中） |
| **AI** | 供应商管理 | 配置和切换 AI CLI 供应商（Claude Code、Codex、Gemini 等） |
| **AI** | CC-Switch 导入 | 从 [CC-Switch](https://github.com/farion1231/cc-switch) 导入供应商配置 |
| **界面** | 暗色 / 亮色主题 | 支持系统主题感知和手动切换 |
| **界面** | 国际化（英文、中文） | 完整双语界面 |
| **界面** | 可折叠侧边栏 | 图标导航侧边栏 |
| **界面** | 系统托盘 | 最小化到托盘，双击恢复 |
| **数据** | SQLite 持久化 | 所有会话、分组、设置本地存储 |
| **数据** | 会话分组 | 按文件夹/分类组织连接 |
| **更新** | 自动更新 | 应用内检查更新，下载并安装 |

### 计划中 🚧

| 功能 | 说明 |
|------|------|
| RDP 连接 | 远程桌面协议支持 |
| Telnet 连接 | 传统 Telnet 协议 |
| VNC 查看器 | 内嵌 VNC 客户端 |
| 文件同步 (rsync) | 双向文件同步 |
| 命令片段管理 | 保存和回放命令片段 |
| 会话录制 | 录制终端会话（asciinema 格式） |
| 多语言 i18n | 日语、韩语、西班牙语、法语、德语、俄语 |
| 标签页拖拽 | 拖拽重排标签页 |
| SSH config 导入 | 从 `~/.ssh/config` 导入 |
| CC-Switch 深度集成 | 完整内置 AI 供应商管理 |
| 插件系统 | 社区插件扩展 |
| WebDAV / S3 浏览器 | 云存储文件管理 |
| 数据库客户端 | 内置 MySQL/PostgreSQL/Redis 客户端 |

---

## 📦 下载

### 安装版（推荐）
| 平台 | 架构 | 下载 |
|------|------|------|
| Windows | x86_64 | [GWShell_x.x.x_x64-setup.exe](https://github.com/hongheshan-svg/gwshell/releases/latest) |
| Windows | ARM64 | [GWShell_x.x.x_arm64-setup.exe](https://github.com/hongheshan-svg/gwshell/releases/latest) |
| macOS | Apple Silicon | [GWShell_x.x.x_aarch64.dmg](https://github.com/hongheshan-svg/gwshell/releases/latest) |
| macOS | Intel | [GWShell_x.x.x_x64.dmg](https://github.com/hongheshan-svg/gwshell/releases/latest) |
| Linux | x86_64 | [.deb](https://github.com/hongheshan-svg/gwshell/releases/latest) / [.AppImage](https://github.com/hongheshan-svg/gwshell/releases/latest) |

### 便携版（免安装）
| 平台 | 下载 |
|------|------|
| Windows x64 | [GWShell-portable-windows-x64.zip](https://github.com/hongheshan-svg/gwshell/releases/latest) |
| Linux x64 | [.AppImage](https://github.com/hongheshan-svg/gwshell/releases/latest) |

---

## 🛠️ 从源码构建

### 前置条件
- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) 1.80+
- 平台特定依赖（参考 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)）

### 步骤

```bash
git clone https://github.com/hongheshan-svg/gwshell.git
cd gwshell
npm install
npm run tauri dev      # 开发模式
npm run tauri build    # 生产构建
```

---

## 🏗️ 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | [Tauri 2](https://v2.tauri.app/) |
| 前端 | React 19, TypeScript 5.8, Vite 7 |
| 后端 | Rust, Tokio (异步运行时) |
| 终端 | [xterm.js](https://xtermjs.org/) 6.x |
| SSH | libssh2 (通过 [ssh2](https://crates.io/crates/ssh2) crate) |
| 数据库 | SQLite (通过 [rusqlite](https://crates.io/crates/rusqlite)) |
| 状态管理 | [Zustand](https://zustand-demo.pmnd.rs/) 5 |
| 图标 | [Lucide](https://lucide.dev/) |

---

## 🙏 致谢

GWShell 受到以下优秀开源项目的启发，在此特别感谢：

### [HexHub](https://github.com/user/hexhub)
一款强大的 SSH/SFTP 客户端，启发了 GWShell 的 SFTP 文件浏览器设计、在线编辑器和分屏终端布局。HexHub 优雅的多标签会话管理和双面板文件传输方案对 GWShell 的架构产生了重要影响。

### [CC-Switch](https://github.com/farion1231/cc-switch)
一款创新的 AI CLI 供应商切换工具，启发了 GWShell 的 AI 集成功能。CC-Switch 管理多种 AI 供应商（Claude Code、Codex、Gemini CLI 等）的方案和简洁的配置系统，促成了 GWShell 内置的 AI 供应商管理功能和配置互通设计。

### 其他灵感来源
- [Tabby](https://github.com/Eugeny/tabby) — 现代终端模拟器
- [Termius](https://termius.com/) — 跨平台 SSH 客户端
- [WindTerm](https://github.com/nicedayzhu/WindTerm) — 高速 SSH/Telnet/串口客户端
- [xterm.js](https://github.com/xtermjs/xterm.js) — 终端渲染引擎
- [Tauri](https://tauri.app/) — 应用框架

---

## 📄 许可证

[MIT](../LICENSE) © GWShell Contributors

---

<div align="center">
  <sub>使用 Tauri + React + Rust 用 ❤️ 构建</sub>
</div>
