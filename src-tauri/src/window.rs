use crate::state::{shutdown_cleanup, AppState};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Manager, State};

pub static OS_INFO: OnceLock<serde_json::Value> = OnceLock::new();

pub fn compute_os_info() -> serde_json::Value {
    let os = std::env::consts::OS;

    #[cfg(target_os = "windows")]
    {
        let mut info = serde_json::json!({ "os": os });
        // Parse the Windows build number from `cmd /c ver`
        // e.g. "Microsoft Windows [Version 10.0.22631.4780]"
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let build: u32 = std::process::Command::new("cmd")
            .args(["/c", "ver"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| {
                let start = s.find('[')?;
                let end = s.find(']')?;
                let ver = &s[start + 1..end]; // "Version 10.0.22631.4780"
                let parts: Vec<&str> = ver.split('.').collect();
                parts.get(2)?.parse().ok()
            })
            .unwrap_or(0);
        info["windowsBuild"] = serde_json::json!(build);
        info
    }

    #[cfg(not(target_os = "windows"))]
    {
        serde_json::json!({ "os": os })
    }
}

#[tauri::command]
pub async fn get_os_info() -> serde_json::Value {
    if let Some(cached) = OS_INFO.get() {
        return cached.clone();
    }
    tokio::task::spawn_blocking(|| OS_INFO.get_or_init(compute_os_info).clone())
        .await
        .unwrap_or_else(|_| serde_json::json!({ "os": std::env::consts::OS }))
}

/// Called by the frontend once React has mounted and painted.
/// Shows the main window only when there is real content to display,
/// eliminating the white-flash that occurs when show() is called before
/// the webview finishes parsing HTML/CSS.
#[tauri::command]
pub async fn app_ready(window: tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
pub fn quit_app(app_handle: tauri::AppHandle, state: State<'_, Arc<AppState>>) {
    shutdown_cleanup(state.inner());
    app_handle.exit(0);
    std::process::exit(0);
}

// ---- Quake (dropdown console) ----

/// Toggle the "main" window between hidden and a top-docked "Quake" dropdown.
///
/// When hidden → reposition the window to the top of the primary monitor,
/// span the full monitor width and half its height, then show + focus.
/// When visible → hide it.
///
/// Monitor geometry is in physical pixels; `set_position`/`set_size` take
/// physical units, so no DPI scaling is applied here. Multi-monitor / mixed-DPI
/// layouts are best-effort (we use whichever monitor Tauri reports).
pub fn toggle_quake_window(app: &AppHandle) {
    let window = match app.get_webview_window("main") {
        Some(w) => w,
        None => return,
    };

    // Treat any error as "not visible" so a failed query still tries to show.
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    // Prefer the monitor the window currently sits on; fall back to primary.
    let monitor = match window.current_monitor() {
        Ok(Some(m)) => Some(m),
        _ => window.primary_monitor().ok().flatten(),
    };

    if let Some(monitor) = monitor {
        let pos = monitor.position();
        let size = monitor.size();
        let _ = window.set_position(tauri::PhysicalPosition { x: pos.x, y: pos.y });
        let _ = window.set_size(tauri::PhysicalSize {
            width: size.width,
            height: size.height / 2,
        });
    }

    let _ = window.show();
    let _ = window.set_focus();
}
