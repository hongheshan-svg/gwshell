mod agent;
mod commands;
mod crypto;
pub mod database;
mod docker;
mod history;
mod metrics;
mod pty;
mod serial;
mod session;
mod ssh;
mod ssh_config;
mod state;
mod totp;
mod vault;
mod window;

pub use state::AppState;

use database::Database;
use parking_lot::Mutex;
use pty::PtyManager;
use serial::SerialManager;
use ssh::SshManager;
use state::{redacted_sessions_for_frontend, shutdown_cleanup};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;
use window::{compute_os_info, toggle_quake_window, OS_INFO};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Warm the keyring master key off the main thread so the synchronous session
    // decrypt below overlaps Database::new()'s file I/O instead of blocking cold
    // start on a (one-time, memoized) keychain lookup.
    std::thread::spawn(|| {
        let _ = crypto::secret_storage_available();
    });
    // Files opened from the SFTP panel in earlier runs are throwaway copies.
    std::thread::spawn(commands::sftp::cleanup_sftp_open_cache);

    let db = Database::new().expect("Failed to initialize database");
    let initial_sessions = db.get_sessions().unwrap_or_default();

    let app_state = Arc::new(AppState {
        pty_manager: PtyManager::new(),
        ssh_manager: Arc::new(SshManager::new()),
        agent_manager: Arc::new(agent::manager::AgentManager::new()),
        agent_log_streams: Mutex::new(HashMap::new()),
        serial_manager: SerialManager::new(),
        sessions: Mutex::new(initial_sessions),
        db,
        metrics: metrics::MetricsManager::new(),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance is launched, focus the existing window
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            window::app_ready,
            window::quit_app,
            window::get_os_info,
            commands::pty::create_local_shell,
            commands::pty::list_shells,
            commands::pty::write_to_pty,
            commands::pty::resize_pty,
            commands::pty::close_pty,
            commands::ssh::ssh_connect,
            commands::ssh::ssh_connect_saved,
            commands::ssh::ssh_test_connection,
            commands::ssh::ssh_trust_host,
            commands::ssh::start_tunnel,
            commands::ssh::write_to_ssh,
            commands::ssh::resize_ssh,
            commands::ssh::close_ssh,
            commands::sftp::sftp_list,
            commands::sftp::sftp_realpath,
            commands::sftp::sftp_mkdir,
            commands::sftp::sftp_rmdir,
            commands::sftp::sftp_delete_file,
            commands::sftp::sftp_rename,
            commands::sftp::sftp_download,
            commands::sftp::sftp_upload,
            commands::sftp::sftp_download_dir,
            commands::sftp::sftp_upload_dir,
            commands::sftp::sftp_open_file,
            commands::sftp::sftp_read_text,
            commands::sftp::sftp_write_text,
            commands::sftp::sftp_chmod,
            commands::sftp::sftp_create_file,
            commands::metrics::start_server_metrics,
            commands::metrics::stop_server_metrics,
            commands::metrics::kill_remote_process,
            commands::metrics::detect_remote_os,
            commands::metrics::probe_remote_env,
            commands::metrics::ping_host,
            commands::serial::serial_open,
            commands::serial::write_to_serial,
            commands::serial::close_serial,
            commands::serial::list_serial_ports,
            commands::storage::save_app_settings,
            commands::storage::load_app_settings,
            agent::commands::load_ai_provider_settings,
            agent::commands::save_ai_provider_settings,
            agent::commands::load_agent_policy_settings,
            agent::commands::save_agent_policy_settings,
            agent::commands::set_ai_provider_api_key,
            agent::commands::clear_ai_provider_api_key,
            agent::commands::test_ai_provider_with_settings,
            agent::terminal_ai::run_terminal_ai_chat,
            agent::terminal_ai::cancel_terminal_ai_chat,
            agent::commands::list_agent_audits,
            agent::commands::start_agent_session,
            agent::commands::run_agent_session,
            agent::commands::list_agent_sessions,
            agent::commands::draft_agent_plan,
            agent::commands::continue_agent_session,
            agent::commands::start_agent_log_stream,
            agent::commands::stop_agent_log_stream,
            agent::commands::cancel_agent_session,
            agent::commands::execute_agent_action,
            agent::commands::save_agent_audit,
            commands::storage::export_sessions_data,
            commands::storage::import_sessions_data,
            commands::storage::import_ssh_config,
            commands::storage::clear_local_data,
            commands::storage::save_session,
            commands::storage::get_sessions,
            commands::storage::delete_session,
            commands::storage::secret_storage_available,
            commands::vault::vault_set_passphrase,
            commands::vault::vault_verify,
            commands::vault::vault_clear,
            commands::vault::vault_is_enabled,
            commands::vault::vault_change_passphrase,
            commands::storage::append_session_log,
            commands::storage::get_command_history,
            commands::storage::save_command_history,
            commands::storage::save_snippet,
            commands::storage::get_snippets,
            commands::storage::delete_snippet,
            docker::docker_list_containers,
            docker::docker_exec,
        ])
        .setup(|app| {
            // Pre-warm OS info cache in a background thread so the first
            // frontend call to get_os_info returns instantly.
            std::thread::spawn(|| {
                OS_INFO.get_or_init(compute_os_info);
            });

            // Serialize initial sessions and inject them into the webview via an
            // initialization script so the frontend Zustand store can populate
            // synchronously on the very first render — no IPC round-trip needed.
            let sessions_json = {
                let state = app.state::<Arc<AppState>>();
                let sessions = state.sessions.lock();
                let redacted = redacted_sessions_for_frontend(&sessions);
                serde_json::to_string(&redacted).unwrap_or_else(|_| "[]".to_string())
            };
            // Inject sessions AND fire a cheap IPC call to warm up the
            // __TAURI_INTERNALS__ → Rust pipeline before the user clicks anything.
            let init_script = format!(
                concat!(
                    "window.__GWSHELL_SESSIONS__={};",
                    "try{{window.__TAURI_INTERNALS__.invoke('get_os_info')}}catch(e){{}};",
                    // Native click handler for the close button — fires in capture phase,
                    // bypasses React entirely. Uses raw Tauri IPC as a guaranteed exit path.
                    "document.addEventListener('click',function(e){{",
                    "if(e.target&&e.target.closest&&e.target.closest('[data-gw-action=\"exit\"]')){{",
                    "try{{window.__TAURI_INTERNALS__.invoke('quit_app')}}catch(_){{",
                    "try{{window.__TAURI_INTERNALS__.invoke('plugin:process|exit',{{code:0}})}}catch(__){{}}",
                    "}}",
                    "}}",
                    "}},true);"
                ),
                sessions_json
            );

            // Create the main window programmatically so we can attach the
            // initialization script (not possible via tauri.conf.json).
            let mut builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("GWShell")
            .inner_size(1280.0, 800.0)
            .min_inner_size(900.0, 600.0)
            .center()
            .resizable(true)
            .visible(false)
            .initialization_script(&init_script);

            #[cfg(target_os = "macos")]
            {
                builder = builder
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true);
            }

            #[cfg(not(target_os = "macos"))]
            {
                builder = builder.decorations(false).transparent(true);
            }

            let main_window = builder.build()?;

            let cleanup_state = app.state::<Arc<AppState>>().inner().clone();
            main_window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                    shutdown_cleanup(&cleanup_state);
                    std::process::exit(0);
                }
            });

            // ---- Quake dropdown console: register global hotkey (opt-in) ----
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;

                let default_hotkey = "CommandOrControl+Shift+Backquote";
                let settings_json = {
                    let state = app.state::<Arc<AppState>>();
                    state.db.load_app_settings().ok().flatten()
                };
                let (quake_enabled, quake_hotkey) = settings_json
                    .as_deref()
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
                    .map(|v| {
                        let enabled = v
                            .get("quakeEnabled")
                            .and_then(|b| b.as_bool())
                            .unwrap_or(false);
                        let hotkey = v
                            .get("quakeHotkey")
                            .and_then(|s| s.as_str())
                            .filter(|s| !s.trim().is_empty())
                            .unwrap_or(default_hotkey)
                            .to_string();
                        (enabled, hotkey)
                    })
                    .unwrap_or((false, default_hotkey.to_string()));

                if quake_enabled {
                    let handle = app.handle().clone();
                    let register = app.global_shortcut().on_shortcut(
                        quake_hotkey.as_str(),
                        move |_app, _shortcut, event| {
                            if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed
                            {
                                toggle_quake_window(&handle);
                            }
                        },
                    );
                    if let Err(e) = register {
                        eprintln!("[quake] failed to register hotkey '{}': {}", quake_hotkey, e);
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running GWShell");
}
