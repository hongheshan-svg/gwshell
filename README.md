<div align="center">

# 🐚 GWShell

**A Modern Cross-Platform SSH / Terminal Manager**

[![Build & Release](https://github.com/hongheshan-svg/gwshell/actions/workflows/build.yml/badge.svg)](https://github.com/hongheshan-svg/gwshell/actions)
[![GitHub Release](https://img.shields.io/github/v/release/hongheshan-svg/gwshell?include_prereleases)](https://github.com/hongheshan-svg/gwshell/releases)
[![License](https://img.shields.io/github/license/hongheshan-svg/gwshell)](LICENSE)

**English** | [简体中文](docs/README_ZH.md) | [日本語](docs/README_JA.md) | [한국어](docs/README_KO.md) | [Español](docs/README_ES.md) | [Français](docs/README_FR.md) | [Deutsch](docs/README_DE.md) | [Русский](docs/README_RU.md)

<img src="docs/screenshot.png" width="800" alt="GWShell Screenshot" />

</div>

---

## ✨ Features

### Implemented ✅

| Category | Feature | Description |
|----------|---------|-------------|
| **SSH** | Multi-tab SSH connections | Connect to multiple servers simultaneously in separate tabs |
| **SSH** | Password / Key / MFA auth | Support for password, private key, keyboard-interactive (TOTP/2FA) authentication |
| **SSH** | SSH Agent forwarding | Use system SSH Agent (OpenSSH / Pageant) for authentication |
| **SSH** | Jump Host (-J) | Proxy connections through a bastion/jump host |
| **SSH** | SOCKS4/5, HTTP proxies | Route SSH connections through proxy servers |
| **SSH** | Port Forwarding | Local port forwarding (SSH tunnel) |
| **SSH** | Connection latency (ping) | Real-time TCP latency measurement for all sessions |
| **SFTP** | File browser | Navigate remote file systems with tree-based panel |
| **SFTP** | Upload / Download | Transfer files between local and remote |
| **SFTP** | Inline text editor | Edit remote files directly with syntax-aware editor |
| **SFTP** | Permissions (chmod) | Change file permissions on remote servers |
| **SFTP** | Rename / Delete / Mkdir | Full file management operations |
| **Terminal** | Local terminal | Open local shells (PowerShell, CMD, Bash, Zsh, etc.) |
| **Terminal** | Split screen | 1×1, 1×2, 2×2, 2×3, 2×4 split layouts |
| **Terminal** | xterm.js rendering | GPU-accelerated terminal with web links, selection |
| **Terminal** | Theme sync | Terminal colors follow app light/dark theme |
| **Serial** | Serial port console | Connect to COM/ttyUSB devices with baud rate config |
| **Docker** | Docker management | Connect to Docker hosts via SSH tunnel (WIP) |
| **AI** | Provider management | Configure & switch AI CLI providers (Claude Code, Codex, Gemini, etc.) |
| **AI** | CC-Switch import | Import provider configs from [CC-Switch](https://github.com/farion1231/cc-switch) |
| **UI** | Dark / Light theme | System-aware theme with manual toggle |
| **UI** | i18n (English, 中文) | Full bilingual interface |
| **UI** | Collapsible sidebar | Drag-free sidebar with icon navigation |
| **UI** | System tray | Minimize to tray, double-click to restore |
| **Data** | SQLite persistence | All sessions, groups, and settings stored locally |
| **Data** | Session groups | Organize connections by folder/category |
| **Update** | Auto-update | In-app update checker with download & install |

### Planned 🚧

| Feature | Description |
|---------|-------------|
| RDP connections | Remote desktop protocol support |
| Telnet connections | Legacy telnet protocol |
| VNC viewer | Embedded VNC client |
| File sync (rsync) | Bi-directional file synchronization |
| Snippet manager | Save & replay command snippets |
| Session recording | Record terminal sessions (asciinema format) |
| Multi-language i18n | Japanese, Korean, Spanish, French, German, Russian |
| Tab drag & drop | Reorder tabs by dragging |
| SSH config import | Import from `~/.ssh/config` |
| CC-Switch deep integration | Full AI provider management built-in |
| Plugin system | Extend GWShell with community plugins |
| WebDAV / S3 browser | Cloud storage file management |
| Database client | Built-in MySQL/PostgreSQL/Redis client |

---

## 📦 Download

### Installer (Recommended)
| Platform | Architecture | Download |
|----------|-------------|----------|
| Windows | x86_64 | [GWShell_x.x.x_x64-setup.exe](https://github.com/hongheshan-svg/gwshell/releases/latest) |
| Windows | ARM64 | [GWShell_x.x.x_arm64-setup.exe](https://github.com/hongheshan-svg/gwshell/releases/latest) |
| macOS | Apple Silicon | [GWShell_x.x.x_aarch64.dmg](https://github.com/hongheshan-svg/gwshell/releases/latest) |
| macOS | Intel | [GWShell_x.x.x_x64.dmg](https://github.com/hongheshan-svg/gwshell/releases/latest) |
| Linux | x86_64 | [gwshell_x.x.x_amd64.deb](https://github.com/hongheshan-svg/gwshell/releases/latest) / [.AppImage](https://github.com/hongheshan-svg/gwshell/releases/latest) |

### Portable (No Install)
| Platform | Download |
|----------|----------|
| Windows x64 | [GWShell-portable-windows-x64.zip](https://github.com/hongheshan-svg/gwshell/releases/latest) |
| Linux x64 | [.AppImage](https://github.com/hongheshan-svg/gwshell/releases/latest) |

---

## 🛠️ Build from Source

### Prerequisites
- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) 1.80+
- Platform-specific dependencies (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))

### Steps

```bash
git clone https://github.com/hongheshan-svg/gwshell.git
cd gwshell
npm install
npm run tauri dev      # Development
npm run tauri build    # Production build
```

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri 2](https://v2.tauri.app/) |
| Frontend | React 19, TypeScript 5.8, Vite 7 |
| Backend | Rust, Tokio (async runtime) |
| Terminal | [xterm.js](https://xtermjs.org/) 6.x |
| SSH | libssh2 (via [ssh2](https://crates.io/crates/ssh2) crate) |
| Database | SQLite (via [rusqlite](https://crates.io/crates/rusqlite)) |
| UI State | [Zustand](https://zustand-demo.pmnd.rs/) 5 |
| Icons | [Lucide](https://lucide.dev/) |

---

## 🙏 Acknowledgments

GWShell is inspired by and grateful to these outstanding open-source projects:

### [HexHub](https://github.com/user/hexhub)
A powerful SSH/SFTP client that inspired GWShell's SFTP file browser design, inline editor, and split-screen terminal layout. HexHub's elegant approach to multi-tab session management and dual-panel file transfer was a major influence on GWShell's architecture.

### [CC-Switch](https://github.com/farion1231/cc-switch)
An innovative AI CLI provider switcher that inspired GWShell's AI integration. CC-Switch's approach to managing multiple AI providers (Claude Code, Codex, Gemini CLI, etc.) and its clean configuration system led to GWShell's built-in AI provider management feature and the config interoperability design.

### Other Inspirations
- [Tabby](https://github.com/Eugeny/tabby) — Modern terminal emulator
- [Termius](https://termius.com/) — Cross-platform SSH client
- [WindTerm](https://github.com/nicedayzhu/WindTerm) — Fast SSH/Telnet/Serial client
- [xterm.js](https://github.com/xtermjs/xterm.js) — The terminal rendering engine
- [Tauri](https://tauri.app/) — The application framework

---

## 📄 License

[MIT](LICENSE) © GWShell Contributors

---

<div align="center">
  <sub>Built with ❤️ using Tauri + React + Rust</sub>
</div>
