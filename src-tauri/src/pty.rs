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
fn resolve_shell(name: Option<&str>) -> CommandBuilder {
    match name {
        Some("powershell7") | Some("powershell") => {
            let mut c = CommandBuilder::new("pwsh");
            c.arg("-NoLogo");
            c
        }
        Some("zsh") => CommandBuilder::new("zsh"),
        Some("fish") => CommandBuilder::new("fish"),
        Some("cmd") => CommandBuilder::new("sh"), // fallback on unix
        _ => CommandBuilder::new("bash"),         // bash (default)
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
        let pwsh_exists = std::process::Command::new("where")
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
                    if name.is_empty() {
                        continue;
                    }
                    // Skip Docker Desktop internal distros that aren't useful interactively
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
        shells.push(ShellEntry {
            id: "bash".into(),
            label: "bash".into(),
        });
        shells.push(ShellEntry {
            id: "zsh".into(),
            label: "zsh".into(),
        });
        shells.push(ShellEntry {
            id: "fish".into(),
            label: "fish".into(),
        });
        if std::process::Command::new("which")
            .arg("pwsh")
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
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
    /// * `charset_str`       — effective charset (e.g. "UTF-8", "GBK"); used
    ///                         for the reader decoder and stored on the handle.
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
        let handle = PtyHandle {
            tx,
            input: input_buffer,
            wake_pending,
            charset: charset_str.clone(),
        };

        self.sessions.lock().insert(session_id.to_string(), handle);

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

        std::thread::spawn(move || {
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
                    match rx.recv_timeout(Duration::from_millis(8)) {
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
                        Ok(PtyCmd::Close) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                            close_requested = true;
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                }
            }

            let _ = child.kill();
            let _ = child.wait();
        });

        Ok(())
    }

    pub fn create_shell(
        &self,
        session_id: &str,
        app_handle: AppHandle,
        rows: u16,
        cols: u16,
        shell_name: Option<String>,
        working_dir: Option<String>,
        charset: Option<String>,
    ) -> Result<(), String> {
        self.close_pty(session_id);

        let mut cmd = resolve_shell(shell_name.as_deref());

        // Set charset-aware env vars
        let charset_str = charset.clone().unwrap_or_else(|| "UTF-8".to_string());
        // Tell CLI/TUI apps the terminal capabilities (critical for apps like claude, vim, htop)
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("PYTHONIOENCODING", &charset_str);
        #[cfg(not(target_os = "windows"))]
        {
            let locale = match charset_str.to_lowercase().as_str() {
                "gbk" | "gb2312" => "zh_CN.GBK",
                "gb18030" => "zh_CN.GB18030",
                "big5" => "zh_TW.Big5",
                "shift-jis" | "shift_jis" => "ja_JP.SJIS",
                "euc-jp" => "ja_JP.EUC-JP",
                "euc-kr" => "ko_KR.EUC-KR",
                "koi8-r" => "ru_RU.KOI8-R",
                _ => "en_US.UTF-8",
            };
            cmd.env("LANG", locale);
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
    ) -> Result<(), String> {
        self.close_pty(session_id);

        let mut cmd = CommandBuilder::new("docker");
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
        if !handle.wake_pending.swap(true, Ordering::AcqRel) {
            if handle.tx.try_send(PtyCmd::WakeInput).is_err() {
                handle.wake_pending.store(false, Ordering::Release);
            }
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

    pub fn close_pty(&self, session_id: &str) {
        if let Some(handle) = self.sessions.lock().remove(session_id) {
            let _ = handle.tx.try_send(PtyCmd::Close);
        }
    }

    pub fn close_all(&self) {
        let handles: Vec<_> = self.sessions.lock().drain().map(|(_, v)| v).collect();
        for handle in handles {
            let _ = handle.tx.try_send(PtyCmd::Close);
        }
    }
}
