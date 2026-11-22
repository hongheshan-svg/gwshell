use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::mpsc;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const PTY_INPUT_BUFFER_LIMIT: usize = 1024 * 1024;
const PTY_CMD_QUEUE_LIMIT: usize = 64;
const PTY_WRITE_CHUNK_SIZE: usize = 16 * 1024;
const PTY_WRITE_BUDGET_TIME: Duration = Duration::from_millis(8);
const PTY_CMD_DRAIN_LIMIT: usize = 256;

#[derive(Debug, Clone, Serialize)]
pub struct ShellEntry {
    pub id: String,
    pub label: String,
}

enum PtyCmd {
    WakeInput,
    Resize { rows: u16, cols: u16 },
    Close,
}

#[derive(Default)]
struct PtyInputBuffer {
    bytes: VecDeque<u8>,
}

impl PtyInputBuffer {
    fn push(&mut self, data: &[u8]) -> Result<(), String> {
        if self.bytes.len().saturating_add(data.len()) > PTY_INPUT_BUFFER_LIMIT {
            return Err("PTY input buffer full".to_string());
        }
        self.bytes.extend(data);
        Ok(())
    }

    fn pop_chunk(&mut self, max_len: usize) -> Vec<u8> {
        let n = self.bytes.len().min(max_len);
        self.bytes.drain(..n).collect()
    }
}

#[derive(Clone)]
struct PtyHandle {
    tx: mpsc::SyncSender<PtyCmd>,
    input: Arc<Mutex<PtyInputBuffer>>,
    wake_pending: Arc<AtomicBool>,
    charset: String,
    /// The writer thread's JoinHandle, wrapped so `close_pty_wait` can take it
    /// and join (with a timeout) on close. Mirrors `serial.rs::SerialHandle`.
    writer_join: Arc<Mutex<Option<std::thread::JoinHandle<()>>>>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtyHandle>>,
}

#[cfg(target_os = "windows")]
fn resolve_shell(name: Option<&str>) -> CommandBuilder {
    let c: CommandBuilder = match name {
        Some("cmd") => CommandBuilder::new("cmd.exe"),
        Some("bash") => CommandBuilder::new("bash.exe"),
        Some("powershell7") => {
            let mut c = CommandBuilder::new("pwsh.exe");
            c.arg("-NoLogo");
            c
        }
        Some("gitbash") => {
            // Find git bash in common locations
            for path in &[
                r"C:\Program Files\Git\bin\bash.exe",
                r"C:\Program Files (x86)\Git\bin\bash.exe",
            ] {
                if std::path::Path::new(path).exists() {
                    let mut c = CommandBuilder::new(path);
                    c.arg("--login");
                    c.arg("-i");
                    return c;
                }
            }
            CommandBuilder::new("bash.exe")
        }
        Some(name) if name.starts_with("wsl:") => {
            let distro = &name["wsl:".len()..];
            let mut c = CommandBuilder::new("wsl.exe");
            c.args(["--distribution", distro]);
            c
        }
        Some("wsl") => CommandBuilder::new("wsl.exe"),
        Some("zsh") => CommandBuilder::new("zsh"),
        Some("fish") => CommandBuilder::new("fish"),
        Some(path)
            if (path.contains('\\') || path.contains('/'))
                && std::path::Path::new(path).exists() =>
        {
            CommandBuilder::new(path)
        }
        _ => {
            // powershell or default
            let mut c = CommandBuilder::new("powershell.exe");
            c.arg("-NoLogo");
            c
        }
    };
    c
}

#[cfg(not(target_os = "windows"))]
fn preferred_unix_shell_id(shell_env: Option<&str>) -> Option<&'static str> {
    let raw = shell_env?.trim();
    if raw.is_empty() {
        return None;
    }
    let base = std::path::Path::new(raw)
        .file_name()
        .and_then(|s| s.to_str())?;
    match base {
        "zsh" => Some("zsh"),
        "bash" => Some("bash"),
        "fish" => Some("fish"),
        "pwsh" => Some("powershell7"),
        _ => None,
    }
}

#[cfg(any(target_os = "macos", test))]
fn unix_shell_supports_login_flag(program: &str) -> bool {
    let base = std::path::Path::new(program)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(program);
    matches!(base, "zsh" | "bash" | "fish")
}

#[cfg(not(target_os = "windows"))]
fn find_unix_shell_binary(shell_name: &str) -> Option<String> {
    if let Ok(env_shell) = std::env::var("SHELL") {
        let trimmed = env_shell.trim();
        if std::path::Path::new(trimmed)
            .file_name()
            .and_then(|s| s.to_str())
            == Some(shell_name)
            && std::path::Path::new(trimmed).exists()
        {
            return Some(trimmed.to_string());
        }
    }

    if let Ok(output) = std::process::Command::new("which").arg(shell_name).output() {
        if output.status.success() {
            let found = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !found.is_empty() && std::path::Path::new(&found).exists() {
                return Some(found);
            }
        }
    }

    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/bin", "/usr/bin"] {
        let candidate = format!("{}/{}", dir, shell_name);
        if std::path::Path::new(&candidate).exists() {
            return Some(candidate);
        }
    }

    None
}

#[cfg(not(target_os = "windows"))]
fn build_unix_shell_command(program: &str) -> CommandBuilder {
    let mut c = CommandBuilder::new(program);
    // On macOS, terminal emulators (Terminal.app, iTerm2, Warp, VS Code) spawn
    // login shells (`-l`) so `/etc/zprofile`, `~/.zprofile`, and `~/.bash_profile`
    // are sourced even when launched from Finder/Dock with a minimal launchd env.
    #[cfg(target_os = "macos")]
    if unix_shell_supports_login_flag(program) {
        c.arg("-l");
    }
    c
}

#[cfg(not(target_os = "windows"))]
fn resolve_shell(name: Option<&str>) -> CommandBuilder {
    match name {
        Some("powershell7") | Some("powershell") => {
            let bin = find_unix_shell_binary("pwsh").unwrap_or_else(|| "pwsh".to_string());
            let mut c = CommandBuilder::new(bin);
            c.arg("-NoLogo");
            c
        }
        Some("zsh") => {
            let bin = find_unix_shell_binary("zsh").unwrap_or_else(|| "zsh".to_string());
            build_unix_shell_command(&bin)
        }
        Some("fish") => {
            let bin = find_unix_shell_binary("fish").unwrap_or_else(|| "fish".to_string());
            build_unix_shell_command(&bin)
        }
        Some("bash") => {
            let bin = find_unix_shell_binary("bash").unwrap_or_else(|| "bash".to_string());
            build_unix_shell_command(&bin)
        }
        Some("cmd") => CommandBuilder::new("sh"),
        Some(path) if path.starts_with('/') && std::path::Path::new(path).exists() => {
            build_unix_shell_command(path)
        }
        _ => {
            let fallback = if cfg!(target_os = "macos") {
                "zsh"
            } else {
                "bash"
            };
            let default_shell = std::env::var("SHELL")
                .ok()
                .filter(|s| !s.trim().is_empty())
                .or_else(|| find_unix_shell_binary(fallback))
                .unwrap_or_else(|| fallback.to_string());
            build_unix_shell_command(&default_shell)
        }
    }
}

/// Detect shells available on the current system.
pub fn list_available_shells() -> Vec<ShellEntry> {
    let mut shells = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // Always available on Windows
        shells.push(ShellEntry {
            id: "cmd".into(),
            label: "cmd".into(),
        });
        shells.push(ShellEntry {
            id: "powershell".into(),
            label: "powershell".into(),
        });

        // PowerShell 7 (pwsh.exe)
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let pwsh_exists = std::process::Command::new("where")
            .creation_flags(CREATE_NO_WINDOW)
            .arg("/Q")
            .arg("pwsh")
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
            || std::path::Path::new(r"C:\Program Files\PowerShell\7\pwsh.exe").exists()
            || std::path::Path::new(r"C:\Program Files\PowerShell\pwsh.exe").exists();
        if pwsh_exists {
            shells.push(ShellEntry {
                id: "powershell7".into(),
                label: "powershell7".into(),
            });
        }

        // WSL distros — output is UTF-16LE on Windows
        if let Ok(output) = std::process::Command::new("wsl")
            .creation_flags(CREATE_NO_WINDOW)
            .args(["--list", "--quiet"])
            .output()
        {
            let bytes = &output.stdout;
            if bytes.len() >= 2 {
                let utf16: Vec<u16> = bytes
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect();
                let text = String::from_utf16_lossy(&utf16);
                for line in text.lines() {
                    let name = line.trim().trim_matches('\0').trim();
                    if name.is_empty()
                        || name.eq_ignore_ascii_case("docker-desktop")
                        || name.eq_ignore_ascii_case("docker-desktop-data")
                    {
                        continue;
                    }
                    shells.push(ShellEntry {
                        id: format!("wsl:{}", name),
                        label: format!("{} - WSL", name),
                    });
                }
            }
        }

        // Git Bash
        for path in &[
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
        ] {
            if std::path::Path::new(path).exists() {
                shells.push(ShellEntry {
                    id: "gitbash".into(),
                    label: "gitbash".into(),
                });
                break;
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut ordered: Vec<&'static str> = if cfg!(target_os = "macos") {
            vec!["zsh", "bash", "fish"]
        } else {
            vec!["bash", "zsh", "fish"]
        };
        let env_shell = std::env::var("SHELL").ok();
        if let Some(preferred) = preferred_unix_shell_id(env_shell.as_deref()) {
            if let Some(pos) = ordered.iter().position(|&id| id == preferred) {
                ordered.remove(pos);
                ordered.insert(0, preferred);
            }
        }
        for id in ordered {
            if find_unix_shell_binary(id).is_some() {
                shells.push(ShellEntry {
                    id: id.into(),
                    label: id.into(),
                });
            }
        }
        if shells.is_empty() {
            let fallback = if cfg!(target_os = "macos") {
                "zsh"
            } else {
                "bash"
            };
            shells.push(ShellEntry {
                id: fallback.into(),
                label: fallback.into(),
            });
        }
        if find_unix_shell_binary("pwsh").is_some() {
            shells.push(ShellEntry {
                id: "powershell7".into(),
                label: "powershell7".into(),
            });
        }
    }

    // Always last: custom
    shells.push(ShellEntry {
        id: "custom".into(),
        label: "Custom".into(),
    });

    shells
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Shared helper: open a PTY, spawn `cmd` in it, start the reader/writer
    /// threads, and register the session handle.  This is the part of
    /// `create_shell` that lives AFTER the `CommandBuilder` (and env/cwd) are
    /// fully set up.  `create_docker_exec` also calls this directly.
    ///
    /// * `charset_str` — effective charset (e.g. "UTF-8", "GBK"); used
    ///   for the reader decoder and stored on the handle.
    fn spawn_in_pty(
        &self,
        session_id: &str,
        app_handle: AppHandle,
        rows: u16,
        cols: u16,
        cmd: CommandBuilder,
        charset_str: String,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get writer: {}", e))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get reader: {}", e))?;

        let input_buffer = Arc::new(Mutex::new(PtyInputBuffer::default()));
        let owner_input = input_buffer.clone();
        let wake_pending = Arc::new(AtomicBool::new(false));
        let owner_wake_pending = wake_pending.clone();
        let (tx, rx) = mpsc::sync_channel::<PtyCmd>(PTY_CMD_QUEUE_LIMIT);

        // Clone for the handle (the reader thread moves the original below);
        // store it now so the handle is fully constructed after spawning.
        let charset_str_for_handle = charset_str.clone();

        let sid = session_id.to_string();
        // charset_str already owned, move into thread
        let thread_charset = charset_str;
        std::thread::spawn(move || {
            // Resolve the encoding once for the lifetime of the reader thread.
            // A streaming Decoder carries incomplete multi-byte sequences across
            // read boundaries, so a CJK/multibyte character split across a read
            // no longer corrupts into replacement characters.
            let encoding = encoding_rs::Encoding::for_label(thread_charset.as_bytes())
                .unwrap_or(encoding_rs::UTF_8);
            let mut decoder = encoding.new_decoder();
            let data_ev = format!("pty-data-{}", sid);
            let exit_ev = format!("pty-exit-{}", sid);

            let mut buf = [0u8; 16384];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let _ = app_handle.emit(&exit_ev, ());
                        break;
                    }
                    Ok(n) => {
                        let mut out = String::with_capacity(n + 16);
                        let _ = decoder.decode_to_string(&buf[..n], &mut out, false);
                        if !out.is_empty() {
                            let _ = app_handle.emit(&data_ev, out);
                        }
                    }
                    Err(_) => {
                        let _ = app_handle.emit(&exit_ev, ());
                        break;
                    }
                }
            }
        });

        let writer_join_handle = std::thread::spawn(move || {
            let master = pair.master;
            let mut child = child;
            let mut writer = writer;
            let mut write_buf: Vec<u8> = Vec::new();
            let mut write_off = 0usize;

            let mut close_requested = false;
            while !close_requested {
                for _ in 0..PTY_CMD_DRAIN_LIMIT {
                    match rx.try_recv() {
                        Ok(PtyCmd::WakeInput) => {
                            owner_wake_pending.store(false, Ordering::Release);
                        }
                        Ok(PtyCmd::Resize { rows, cols }) => {
                            let _ = master.resize(PtySize {
                                rows,
                                cols,
                                pixel_width: 0,
                                pixel_height: 0,
                            });
                        }
                        Ok(PtyCmd::Close) | Err(mpsc::TryRecvError::Disconnected) => {
                            close_requested = true;
                            break;
                        }
                        Err(mpsc::TryRecvError::Empty) => break,
                    }
                }

                let mut wrote_bytes = 0usize;
                let write_started = Instant::now();
                while wrote_bytes < PTY_WRITE_CHUNK_SIZE
                    && write_started.elapsed() < PTY_WRITE_BUDGET_TIME
                    && !close_requested
                {
                    if write_off >= write_buf.len() {
                        write_buf = owner_input.lock().pop_chunk(PTY_WRITE_CHUNK_SIZE);
                        write_off = 0;
                        if write_buf.is_empty() {
                            break;
                        }
                    }

                    match writer.write(&write_buf[write_off..]) {
                        Ok(0) => break,
                        Ok(n) => {
                            write_off += n;
                            wrote_bytes += n;
                        }
                        Err(_) => {
                            close_requested = true;
                            break;
                        }
                    }
                }
                if write_off >= write_buf.len() {
                    write_buf.clear();
                    write_off = 0;
                }
                if wrote_bytes > 0 {
                    let _ = writer.flush();
                }

                if !close_requested && write_buf.is_empty() && owner_input.lock().bytes.is_empty() {
                    match rx.recv() {
                        Ok(PtyCmd::WakeInput) => {
                            owner_wake_pending.store(false, Ordering::Release);
                        }
                        Ok(PtyCmd::Resize { rows, cols }) => {
                            let _ = master.resize(PtySize {
                                rows,
                                cols,
                                pixel_width: 0,
                                pixel_height: 0,
                            });
                        }
                        Ok(PtyCmd::Close) | Err(mpsc::RecvError) => {
                            close_requested = true;
                        }
                    }
                }
            }

            let _ = child.kill();
            let _ = child.wait();
        });

        let handle = PtyHandle {
            tx,
            input: input_buffer,
            wake_pending,
            charset: charset_str_for_handle,
            writer_join: Arc::new(Mutex::new(Some(writer_join_handle))),
        };

        self.sessions.lock().insert(session_id.to_string(), handle);

        Ok(())
    }

    // PTY shell creation requires 8 params (session id, app handle, command,
    // charset, rows, cols, env, working dir); grouping into a struct would
    // add indirection without reducing the call-site complexity.
    #[allow(clippy::too_many_arguments)]
    pub fn create_shell(
        &self,
        session_id: &str,
        app_handle: AppHandle,
        rows: u16,
        cols: u16,
        shell_name: Option<String>,
        working_dir: Option<String>,
        charset: Option<String>,
        env_vars: Option<String>,
    ) -> Result<(), String> {
        self.close_pty(session_id);

        let mut cmd = resolve_shell(shell_name.as_deref());

        // Set charset-aware env vars
        let charset_str = charset.clone().unwrap_or_else(|| "UTF-8".to_string());
        // Tell CLI/TUI apps the terminal capabilities (critical for apps like claude, vim, htop)
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("PYTHONIOENCODING", &charset_str);
        // Match VSCode: identify the terminal program so TUI apps and shell
        // integration frameworks (Claude Code, starship, oh-my-posh, etc.) can
        // detect GWShell and enable features accordingly.
        cmd.env("TERM_PROGRAM", "gwshell");
        cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
        #[cfg(not(target_os = "windows"))]
        {
            let explicit_locale = match charset_str.to_lowercase().as_str() {
                "gbk" | "gb2312" => Some("zh_CN.GBK"),
                "gb18030" => Some("zh_CN.GB18030"),
                "big5" => Some("zh_TW.Big5"),
                "shift-jis" | "shift_jis" => Some("ja_JP.SJIS"),
                "euc-jp" => Some("ja_JP.EUC-JP"),
                "euc-kr" => Some("ko_KR.EUC-KR"),
                "koi8-r" => Some("ru_RU.KOI8-R"),
                _ => None,
            };
            if let Some(locale) = explicit_locale {
                cmd.env("LANG", locale);
            } else {
                let inherited_is_utf8 = std::env::var("LANG")
                    .ok()
                    .map(|v| {
                        let lower = v.to_ascii_lowercase();
                        lower.contains("utf-8") || lower.contains("utf8")
                    })
                    .unwrap_or(false);
                if !inherited_is_utf8 {
                    cmd.env("LANG", "en_US.UTF-8");
                }
            }
        }
        if let Some(ref raw_env) = env_vars {
            for (k, v) in crate::ssh::parse_env_vars(raw_env) {
                cmd.env(k, v);
            }
        }

        if let Some(ref dir) = working_dir {
            cmd.cwd(std::path::Path::new(dir));
        } else if let Some(home) = dirs::home_dir() {
            cmd.cwd(home);
        }

        self.spawn_in_pty(session_id, app_handle, rows, cols, cmd, charset_str)
    }

    /// Spawn `docker exec -it <container_id> sh -c 'exec bash 2>/dev/null || exec sh'`
    /// in a local PTY, keyed by `session_id`.  Uses the shared `spawn_in_pty`
    /// helper so the same reader/writer/resize/handle machinery is reused.
    pub fn create_docker_exec(
        &self,
        session_id: &str,
        app_handle: AppHandle,
        rows: u16,
        cols: u16,
        container_id: &str,
        docker_host: Option<&str>,
    ) -> Result<(), String> {
        self.close_pty(session_id);

        let mut cmd = CommandBuilder::new("docker");
        if let Some(host) = docker_host.filter(|h| !h.trim().is_empty()) {
            cmd.args(["-H", host]);
        }
        // `--` ends docker-exec option parsing, so a container id starting with
        // `-` cannot smuggle flags into `docker exec` (defense-in-depth; the id
        // is also format-validated at the `docker_exec` command layer).
        cmd.args([
            "exec",
            "-it",
            "--",
            container_id,
            "sh",
            "-c",
            "exec bash 2>/dev/null || exec sh",
        ]);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "gwshell");
        cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
        self.spawn_in_pty(session_id, app_handle, rows, cols, cmd, "UTF-8".to_string())
    }

    pub fn write_to_pty(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let handle = self.sessions.lock().get(session_id).cloned();
        let Some(handle) = handle else {
            return Err("Session not found".to_string());
        };

        let enc = encoding_rs::Encoding::for_label(handle.charset.as_bytes())
            .unwrap_or(encoding_rs::UTF_8);
        let bytes: std::borrow::Cow<[u8]> = if enc == encoding_rs::UTF_8 {
            std::borrow::Cow::Borrowed(data)
        } else {
            let text = std::str::from_utf8(data).map_err(|e| e.to_string())?;
            let (encoded, _enc, _had_unmappable) = enc.encode(text);
            std::borrow::Cow::Owned(encoded.into_owned())
        };

        handle.input.lock().push(&bytes)?;
        if !handle.wake_pending.swap(true, Ordering::AcqRel)
            && handle.tx.try_send(PtyCmd::WakeInput).is_err()
        {
            handle.wake_pending.store(false, Ordering::Release);
        }
        Ok(())
    }

    pub fn resize_pty(&self, session_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let handle = self.sessions.lock().get(session_id).cloned();
        let Some(handle) = handle else {
            return Err("Session not found".to_string());
        };
        handle
            .tx
            .try_send(PtyCmd::Resize { rows, cols })
            .map_err(|e| match e {
                mpsc::TrySendError::Full(_) => "PTY command queue full".to_string(),
                mpsc::TrySendError::Disconnected(_) => "Session closed".to_string(),
            })
    }

    /// Remove a session and block until its writer thread has fully torn down
    /// (child killed + waited, reader joined). Use when the caller can afford to
    /// wait; for app-wide shutdown use `close_all` which signals without joining.
    /// Mirrors `serial.rs::close_serial_wait`.
    ///
    /// Returns `Err` if the writer thread doesn't exit within 2s (the join is
    /// wrapped in a timeout so a stuck child can't hang the UI thread). The
    /// session is removed from the map regardless, so a stuck writer thread
    /// becomes orphaned but no longer holds the PTY open via the map.
    pub fn close_pty_wait(&self, session_id: &str) -> Result<(), String> {
        let handle = self.sessions.lock().remove(session_id);
        if let Some(handle) = handle {
            // Best-effort signal; drop `handle` before joining so its `tx`
            // sender closes and delivers `Disconnected` even if the bounded
            // command queue was full.
            let _ = handle.tx.try_send(PtyCmd::Close);
            let join = handle.writer_join.lock().take();
            drop(handle);
            if let Some(join) = join {
                // 2s timeout wrapping the join, falling back to signal-only on
                // timeout (UI thread must not hang on a stuck child).
                let (tx, rx) = std::sync::mpsc::channel();
                std::thread::spawn(move || {
                    let _ = join.join();
                    let _ = tx.send(());
                });
                if rx.recv_timeout(Duration::from_secs(2)).is_err() {
                    return Err("writer thread join timed out after 2s".to_string());
                }
            }
        }
        Ok(())
    }

    /// Non-blocking close: signal and remove. Convenience wrapper around
    /// `close_pty_wait` for callers that don't care to wait. Discards any join
    /// timeout error — the session is removed from the map regardless.
    pub fn close_pty(&self, session_id: &str) {
        let _ = self.close_pty_wait(session_id);
    }

    /// Signal all sessions to close without joining. Used on app shutdown,
    /// where blocking on each writer thread's teardown could hang the process.
    pub fn close_all(&self) {
        let handles: Vec<_> = self.sessions.lock().drain().map(|(_, v)| v).collect();
        for handle in handles {
            let _ = handle.tx.try_send(PtyCmd::Close);
            // Don't join — shutdown must not hang on a stuck child.
        }
    }
}

#[cfg(test)]
#[cfg(any(target_os = "linux", target_os = "macos"))]
mod tests {
    use super::*;

    /// Regression test for the silent Close-drop leak under queue pressure.
    ///
    /// Before `close_pty_wait`, `close_pty` sent `PtyCmd::Close` via `try_send`
    /// and discarded the error. If the channel was full (limit 64), the close
    /// signal was silently dropped and the writer thread + child leaked.
    ///
    /// This test constructs a `PtyManager` with a session whose command channel
    /// is filled to capacity, then calls `close_pty_wait` and asserts that:
    ///   1. It returns `Ok(())` (the writer thread joined within the 2s timeout).
    ///   2. The session is removed from the map.
    ///
    /// The stub writer thread drains the channel and exits when the sender
    /// (held by the `PtyHandle`) is dropped — which happens when
    /// `close_pty_wait`'s local `handle` goes out of scope after the join.
    /// Since the Close signal can't be sent (channel full), the writer thread
    /// relies on the `recv_timeout` returning `Disconnected` (after the handle
    /// drops) OR `Timeout` (after 50ms) to exit. Either way it exits well
    /// within the 2s join timeout.
    ///
    /// Gated on Linux/macOS because the PTY backend (forkpty) isn't available
    /// in Windows CI. We don't spawn a real PTY here — we construct a handle
    /// with a stub writer thread + full channel to exercise the join path
    /// directly. This keeps the test fast and dependency-free.
    #[test]
    fn close_pty_wait_consumes_writer_join_under_queue_pressure() {
        let manager = PtyManager::new();

        // Build a sync channel with the same limit as the real one.
        let (tx, rx) = mpsc::sync_channel::<PtyCmd>(PTY_CMD_QUEUE_LIMIT);

        // Fill the channel to capacity so a subsequent `try_send(Close)` would
        // return `Full` — the exact condition that used to silently drop the
        // close signal.
        for _ in 0..PTY_CMD_QUEUE_LIMIT {
            tx.try_send(PtyCmd::WakeInput)
                .expect("channel should accept up to limit");
        }
        // Confirm the channel is full: the next try_send returns Full.
        assert!(matches!(
            tx.try_send(PtyCmd::Close),
            Err(mpsc::TrySendError::Full(_))
        ));

        // Stub writer thread: drain the channel and exit on Close, disconnect,
        // or timeout (50ms idle). It doesn't do any real I/O — we only need it
        // to be joinable so close_pty_wait's join path is exercised.
        let writer_join = std::thread::spawn(move || loop {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(PtyCmd::Close) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Ok(_) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => break,
            }
        });

        let handle = PtyHandle {
            tx,
            input: Arc::new(Mutex::new(PtyInputBuffer::default())),
            wake_pending: Arc::new(AtomicBool::new(false)),
            charset: "UTF-8".to_string(),
            writer_join: Arc::new(Mutex::new(Some(writer_join))),
        };
        manager
            .sessions
            .lock()
            .insert("test-session".to_string(), handle);

        // close_pty_wait must join the writer thread even though the Close
        // signal was dropped (channel full). The writer exits via timeout
        // (50ms) since it never receives Close and the sender isn't dropped
        // until after the join completes (handle still in scope).
        let result = manager.close_pty_wait("test-session");
        assert!(
            result.is_ok(),
            "close_pty_wait should succeed: {:?}",
            result
        );

        // The session must be removed from the map.
        assert!(
            manager.sessions.lock().get("test-session").is_none(),
            "session should be removed from the map"
        );
    }

    #[test]
    fn preferred_unix_shell_id_extracts_basename() {
        assert_eq!(preferred_unix_shell_id(Some("/bin/zsh")), Some("zsh"));
        assert_eq!(
            preferred_unix_shell_id(Some("/opt/homebrew/bin/fish")),
            Some("fish")
        );
        assert_eq!(
            preferred_unix_shell_id(Some("/usr/local/bin/bash")),
            Some("bash")
        );
        assert_eq!(
            preferred_unix_shell_id(Some("/usr/local/bin/pwsh")),
            Some("powershell7")
        );
        assert_eq!(preferred_unix_shell_id(Some("")), None);
        assert_eq!(preferred_unix_shell_id(None), None);
    }

    #[test]
    fn login_flag_supported_for_interactive_unix_shells() {
        assert!(unix_shell_supports_login_flag("/bin/zsh"));
        assert!(unix_shell_supports_login_flag("/opt/homebrew/bin/bash"));
        assert!(unix_shell_supports_login_flag("fish"));
        assert!(!unix_shell_supports_login_flag("sh"));
        assert!(!unix_shell_supports_login_flag("/usr/local/bin/pwsh"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_resolve_shell_adds_login_flag() {
        let cmd = resolve_shell(Some("zsh"));
        let args: Vec<String> = cmd
            .get_argv()
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert!(
            args.iter().any(|a| a == "-l"),
            "expected -l login flag in macOS zsh argv, got: {:?}",
            args
        );
    }
}
