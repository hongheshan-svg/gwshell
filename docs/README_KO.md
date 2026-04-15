<div align="center">

# 🐚 GWShell

**현대적인 크로스 플랫폼 SSH / 터미널 매니저**

[![Build & Release](https://github.com/hongheshan-svg/gwshell/actions/workflows/build.yml/badge.svg)](https://github.com/hongheshan-svg/gwshell/actions)
[![GitHub Release](https://img.shields.io/github/v/release/hongheshan-svg/gwshell?include_prereleases)](https://github.com/hongheshan-svg/gwshell/releases)
[![License](https://img.shields.io/github/license/hongheshan-svg/gwshell)](../LICENSE)

[English](../README.md) | [简体中文](README_ZH.md) | [日本語](README_JA.md) | **한국어** | [Español](README_ES.md) | [Français](README_FR.md) | [Deutsch](README_DE.md) | [Русский](README_RU.md)

</div>

---

## ✨ 기능

### 구현됨 ✅

| 카테고리 | 기능 | 설명 |
|---------|------|------|
| **SSH** | 멀티탭 SSH 접속 | 여러 서버에 동시 접속 |
| **SSH** | 비밀번호 / 키 / MFA 인증 | 비밀번호, 개인키, TOTP/2FA 지원 |
| **SSH** | 점프 호스트 (-J) | 배스천/점프 호스트를 통한 프록시 접속 |
| **SSH** | SOCKS4/5, HTTP 프록시 | 프록시 서버를 통한 SSH 접속 |
| **SSH** | 포트 포워딩 | 로컬 포트 포워딩 (SSH 터널) |
| **SSH** | 연결 지연 시간 (ping) | 실시간 TCP 지연 시간 측정 |
| **SFTP** | 파일 브라우저 | 트리 패널로 원격 파일 시스템 탐색 |
| **SFTP** | 업로드 / 다운로드 | 로컬과 원격 간 파일 전송 |
| **SFTP** | 인라인 텍스트 에디터 | 원격 파일 직접 편집 |
| **터미널** | 로컬 터미널 | PowerShell, CMD, Bash, Zsh 등 |
| **터미널** | 화면 분할 | 1×1, 1×2, 2×2, 2×3, 2×4 분할 레이아웃 |
| **시리얼** | 시리얼 포트 콘솔 | COM/ttyUSB 장치 연결 |
| **AI** | 프로바이더 관리 | AI CLI 프로바이더 설정 및 전환 |
| **UI** | 다크 / 라이트 테마 | 시스템 테마 감지 및 수동 전환 |
| **UI** | i18n (English, 中文) | 완전한 2개 국어 인터페이스 |
| **데이터** | SQLite 영속화 | 모든 세션, 설정을 로컬에 저장 |
| **업데이트** | 자동 업데이트 | 앱 내 업데이트 확인 및 설치 |

### 계획 중 🚧

RDP 접속, Telnet, VNC 뷰어, 파일 동기화, 명령어 스니펫, 세션 녹화, 다국어 i18n, 탭 드래그 앤 드롭, SSH config 가져오기, 플러그인 시스템

---

## 📦 다운로드

[최신 릴리스](https://github.com/hongheshan-svg/gwshell/releases/latest)에서 플랫폼에 맞는 설치 프로그램 또는 포터블 버전을 다운로드하세요.

---

## 🙏 감사의 말

- [Tauri](https://tauri.app/), [xterm.js](https://xtermjs.org/), [Tabby](https://github.com/Eugeny/tabby), [WindTerm](https://github.com/nicedayzhu/WindTerm)

## 📄 라이선스

[MIT](../LICENSE) © GWShell Contributors
