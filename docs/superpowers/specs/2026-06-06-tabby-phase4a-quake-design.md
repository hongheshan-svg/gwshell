# Phase 4a 设计:Quake 下拉控制台

- 2026-06-06 · Rust(Tauri 插件)+ 前端设置 · **cargo 验编译;全局热键+窗口定位行为不可在此验证(用户自验)**

## 现状
- 主窗口在 `lib.rs setup()` 用 `WebviewWindowBuilder` 程序化创建("main")。无 `tauri-plugin-global-shortcut`(需新增 dep)。close→exit。
- 设置存 SQLite `app_settings`(单 JSON blob),Rust 端可 `state.db.load_app_settings()` 读。

## 设计
1. **依赖**:`Cargo.toml` 加 `tauri-plugin-global-shortcut = "2"`;`.plugin(tauri_plugin_global_shortcut::Builder::new()...build())`;capabilities 加对应权限。
2. **启动注册**:`setup()` 里读 `app_settings` JSON 取 `quakeEnabled`(默认 false)与 `quakeHotkey`(默认 `"CommandOrControl+Shift+Backquote"`);若启用,注册该全局热键 → 调切换逻辑。
3. **切换逻辑**(Rust 命令 `toggle_quake_window(app)` + 热键 handler 共用):取 "main" 窗口;若 `is_visible()` → `hide()`;否则 → 定位为 quake 下拉(置于主显示器顶部、宽=屏宽、高=屏高一半,`set_position`/`set_size` 用 monitor 尺寸)→ `show()` → `set_focus()`。
4. **前端设置**:`quakeEnabled: boolean`(默认 false)、`quakeHotkey: string`(默认上值)加入两处 AppSettings + 默认 + SettingsModal 两行(toggle + 文本)。改动需重启生效(v1,标注)。i18n。

## 边界/风险
- 全局热键可能与其它 app 冲突 → 默认带 Shift 降低概率;opt-in(默认关)。
- 窗口定位用主显示器尺寸;多显示器/缩放未验证。
- 改 hotkey/enabled 需重启重注册(v1)。
- **整体运行时不可验证**:全局热键触发、显隐、定位都需用户实机测。
- 不动终端 I/O。

## 测试
`cargo check` 必过(会拉取新 dep)。运行时(用户):开启 quake + 重启 → 按热键窗口下拉显隐。
