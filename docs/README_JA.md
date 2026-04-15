<div align="center">

# 🐚 GWShell

**モダンなクロスプラットフォーム SSH / ターミナルマネージャー**

[![Build & Release](https://github.com/hongheshan-svg/gwshell/actions/workflows/build.yml/badge.svg)](https://github.com/hongheshan-svg/gwshell/actions)
[![GitHub Release](https://img.shields.io/github/v/release/hongheshan-svg/gwshell?include_prereleases)](https://github.com/hongheshan-svg/gwshell/releases)
[![License](https://img.shields.io/github/license/hongheshan-svg/gwshell)](../LICENSE)

[English](../README.md) | [简体中文](README_ZH.md) | **日本語** | [한국어](README_KO.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Deutsch](README_DE.md) | [Русский](README_RU.md)

</div>

---

## ✨ 機能

### 実装済み ✅

| カテゴリ | 機能 | 説明 |
|---------|------|------|
| **SSH** | マルチタブ SSH 接続 | 複数サーバーへの同時接続 |
| **SSH** | パスワード / 鍵 / MFA 認証 | パスワード、秘密鍵、TOTP/2FA 対応 |
| **SSH** | ジャンプホスト (-J) | 踏み台サーバー経由の接続 |
| **SSH** | SOCKS4/5, HTTP プロキシ | プロキシ経由の SSH 接続 |
| **SSH** | ポートフォワーディング | ローカルポート転送（SSH トンネル） |
| **SSH** | 接続レイテンシ (ping) | リアルタイム TCP レイテンシ測定 |
| **SFTP** | ファイルブラウザー | ツリーパネルでリモートファイルシステムを閲覧 |
| **SFTP** | アップロード / ダウンロード | ローカルとリモート間のファイル転送 |
| **SFTP** | インラインテキストエディター | リモートファイルを直接編集 |
| **ターミナル** | ローカルターミナル | PowerShell、CMD、Bash、Zsh 等のローカルシェル |
| **ターミナル** | 画面分割 | 1×1、1×2、2×2、2×3、2×4 分割レイアウト |
| **シリアル** | シリアルポートコンソール | COM/ttyUSB デバイス接続 |
| **AI** | プロバイダー管理 | AI CLI プロバイダーの設定と切替 |
| **UI** | ダーク / ライトテーマ | テーマ自動検出と手動切替 |
| **UI** | i18n（English、中文） | 完全バイリンガル対応 |
| **データ** | SQLite 永続化 | すべてのセッション・設定をローカル保存 |
| **更新** | 自動アップデート | アプリ内でアップデート確認・インストール |

### 計画中 🚧

RDP 接続、Telnet、VNC ビューアー、ファイル同期、コマンドスニペット、セッション録画、多言語 i18n、タブドラッグ＆ドロップ、SSH config インポート、プラグインシステム

---

## 📦 ダウンロード

[最新リリース](https://github.com/hongheshan-svg/gwshell/releases/latest) からお使いのプラットフォーム用のインストーラーまたはポータブル版をダウンロードしてください。

---

## 🙏 謝辞

- [Tauri](https://tauri.app/)、[xterm.js](https://xtermjs.org/)、[Tabby](https://github.com/Eugeny/tabby)、[WindTerm](https://github.com/nicedayzhu/WindTerm)

## 📄 ライセンス

[MIT](../LICENSE) © GWShell Contributors
