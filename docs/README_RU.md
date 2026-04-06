<div align="center">

# 🐚 GWShell

**Современный кроссплатформенный SSH / Терминал менеджер**

[![Build & Release](https://github.com/hongheshan-svg/gwshell/actions/workflows/build.yml/badge.svg)](https://github.com/hongheshan-svg/gwshell/actions)
[![GitHub Release](https://img.shields.io/github/v/release/hongheshan-svg/gwshell?include_prereleases)](https://github.com/hongheshan-svg/gwshell/releases)
[![License](https://img.shields.io/github/license/hongheshan-svg/gwshell)](../LICENSE)

[English](../README.md) | [简体中文](README_ZH.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Deutsch](README_DE.md) | **Русский**

</div>

---

## ✨ Возможности

### Реализовано ✅

| Категория | Функция | Описание |
|-----------|---------|----------|
| **SSH** | Многовкладочные SSH-соединения | Одновременное подключение к нескольким серверам |
| **SSH** | Аутентификация пароль / ключ / MFA | Пароль, приватный ключ, TOTP/2FA |
| **SSH** | Промежуточный хост (-J) | Прокси-подключения через бастион |
| **SSH** | SOCKS4/5, HTTP прокси | Маршрутизация SSH через прокси-серверы |
| **SSH** | Перенаправление портов | Локальное перенаправление портов (SSH-туннель) |
| **SSH** | Задержка соединения (ping) | Измерение TCP-задержки в реальном времени |
| **SFTP** | Файловый менеджер | Обзор удалённых файловых систем |
| **SFTP** | Загрузка / Скачивание | Передача файлов между локальным и удалённым |
| **SFTP** | Встроенный текстовый редактор | Прямое редактирование удалённых файлов |
| **Терминал** | Локальный терминал | PowerShell, CMD, Bash, Zsh и др. |
| **Терминал** | Разделение экрана | Макеты 1×1, 1×2, 2×2, 2×3, 2×4 |
| **Сериал** | Консоль серийного порта | Подключение к устройствам COM/ttyUSB |
| **AI** | Управление провайдерами | Настройка и переключение провайдеров AI CLI |
| **UI** | Тёмная / Светлая тема | Автоматическое определение системной темы |
| **UI** | i18n (English, 中文) | Полностью двуязычный интерфейс |
| **Данные** | Сохранение в SQLite | Локальное хранение всех сессий и настроек |
| **Обновление** | Автоматическое обновление | Проверка и установка обновлений в приложении |

### Планируется 🚧

RDP-соединения, Telnet, VNC-просмотрщик, синхронизация файлов, менеджер сниппетов, запись сессий, многоязычная i18n, перетаскивание вкладок, импорт SSH config, глубокая интеграция CC-Switch, система плагинов

---

## 📦 Скачать

Загрузите установщик или портативную версию для вашей платформы из [последнего релиза](https://github.com/hongheshan-svg/gwshell/releases/latest).

---

## 🙏 Благодарности

- [HexHub](https://github.com/user/hexhub) — Вдохновение для файлового менеджера SFTP и разделения экрана
- [CC-Switch](https://github.com/farion1231/cc-switch) — Вдохновение для управления AI-провайдерами
- [Tauri](https://tauri.app/), [xterm.js](https://xtermjs.org/), [Tabby](https://github.com/Eugeny/tabby), [WindTerm](https://github.com/nicedayzhu/WindTerm)

## 📄 Лицензия

[MIT](../LICENSE) © GWShell Contributors
