use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::mpsc;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};

/// Monotonic counter for unique temp-file naming (pid + counter).
static SHELL_INTEGRATION_COUNTER: AtomicU64 = AtomicU64::new(0);

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
fn resolve_shell(name: Option<&str>, _shell_integration: bool) -> CommandBuilder {
    // Shell integration (OSC 133) is not injected on Windows for now.
    match name {
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
    }
}

#[cfg(not(target_os = "windows"))]
fn resolve_shell(name: Option<&str>, shell_integration: bool) -> CommandBuilder {
    match name {
        Some("powershell7") | Some("powershell") => {
            let mut c = CommandBuilder::new("pwsh");
            c.arg("-NoLogo");
            // No OSC 133 injection for pwsh on unix
            c
        }
        Some("zsh") => {
            let mut c = CommandBuilder::new("zsh");
            if shell_integration {
                if let Some(tmp_dir) = write_zsh_integration() {
                    // Preserve original ZDOTDIR (or $HOME) so .zshrc can source it
                    let original_zdotdir = std::env::var("ZDOTDIR")
                        .unwrap_or_else(|_| {
                            dirs::home_dir()
                                .map(|h| h.to_string_lossy().into_owned())
                                .unwrap_or_default()
                        });
                    c.env("ZDOTDIR", &tmp_dir);
                    c.env("__gw_user_zdotdir", original_zdotdir);
                }
            }
            c
        }
        Some("fish") => {
            let mut c = CommandBuilder::new("fish");
            if shell_integration {
                let init_cmd = concat!(
                    "function __gw_pre --on-event fish_preexec; printf '\\033]133;C\\007'; end; ",
                    "function __gw_post --on-event fish_postexec; printf '\\033]133;D;%s\\007' $status; end; ",
                    "function __gw_prompt --on-event fish_prompt; printf '\\033]133;A\\007'; end"
                );
                c.arg("--init-command");
                c.arg(init_cmd);
            }
            c
        }
        Some("cmd") => CommandBuilder::new("sh"), // fallback on unix
        _ => {
            // bash (default)
            let mut c = CommandBuilder::new("bash");
            if shell_integration {
                if let Some(rc_path) = write_bash_integration() {
                    c.arg("--rcfile");
                    c.arg(&rc_path);
                    c.arg("-i");
                }
            }
            c
        }
    }
}

/// Write a bash rcfile with OSC 133 integration and return its path.
/// Returns None on any I/O error (shell will start without integration).
///
/// Security: file is created with O_CREAT|O_EXCL (fails if path exists) and
/// mode 0600 (owner-read/write only), using an unpredictable name that includes
/// pid + monotonic counter + subsecond nanosecond timestamp entropy.
#[cfg(not(target_os = "windows"))]
fn write_bash_integration() -> Option<std::path::PathBuf> {
    // NOTE: \033 and \007 are literal backslash sequences — the shell's
    // `printf` builtin will interpret them as ESC (0x1b) and BEL (0x07).
    // FIX 3: PS0 must NOT use \[ \] readline markers — bash doesn't strip
    // them in PS0, leaking 0x01/0x02 bytes. PS1 keeps \[ \] (correct there).
    let content = r#"[ -f ~/.bashrc ] && source ~/.bashrc
__gw_precmd() { local e=$?; printf '\033]133;D;%s\007' "$e"; }
case "$PROMPT_COMMAND" in *__gw_precmd*) ;; *) PROMPT_COMMAND='__gw_precmd'${PROMPT_COMMAND:+';'$PROMPT_COMMAND} ;; esac
PS1='\[\033]133;A\007\]'"$PS1"'\[\033]133;B\007\]'
PS0='\033]133;C\007'"$PS0"
"#;

    let pid = std::process::id();
    let tmp = std::env::temp_dir();

    // Retry a few times in case a name collision occurs (extremely unlikely).
    for attempt in 0u64..8 {
        let counter = SHELL_INTEGRATION_COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let file_name = format!("gw_bash_rc_{}_{}_{}", pid, counter.wrapping_add(attempt), nanos);
        let path = tmp.join(file_name);

        // O_CREAT|O_EXCL: fails atomically if path already exists → defeats
        // symlink/pre-create races. Mode 0600: owner-only read/write.
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
        {
            Ok(mut f) => {
                if f.write_all(content.as_bytes()).is_ok() {
                    return Some(path);
                } else {
                    // Write failed; clean up and give up.
                    let _ = std::fs::remove_file(&path);
                    return None;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                // Name collision — try again with a fresh counter/nanos.
                continue;
            }
            Err(_) => return None,
        }
    }
    None
}

/// Write a zsh integration directory (containing .zshenv + .zshrc) and return the dir path.
/// Returns None on any I/O error.
///
/// Security: directory is created with mode 0700 (owner-only) using DirBuilder
/// with recursive=false on the final component, so creation fails atomically if
/// the path already exists. Name includes pid + counter + subsecond nanos entropy.
///
/// FIX 2: We also write a .zshenv that sources the user's real .zshenv, because
/// zsh reads $ZDOTDIR/.zshenv unconditionally and overriding ZDOTDIR would
/// otherwise skip the user's env setup (PATH shims, Homebrew, asdf, fnm, etc.).
#[cfg(not(target_os = "windows"))]
fn write_zsh_integration() -> Option<std::path::PathBuf> {
    // NOTE: \033 and \007 are literal backslash sequences for the shell's printf.
    let zshenv_content = r#"[ -f "${__gw_user_zdotdir:-$HOME}/.zshenv" ] && source "${__gw_user_zdotdir:-$HOME}/.zshenv"
"#;

    let zshrc_content = r#"[ -f "${__gw_user_zdotdir:-$HOME}/.zshrc" ] && source "${__gw_user_zdotdir:-$HOME}/.zshrc"
autoload -Uz add-zsh-hook
__gw_preexec() { print -n '\033]133;C\007' }
__gw_precmd()  { print -n "\033]133;D;$?\007\033]133;A\007" }
add-zsh-hook preexec __gw_preexec
add-zsh-hook precmd  __gw_precmd
"#;

    let pid = std::process::id();
    let tmp = std::env::temp_dir();

    // Retry a few times in case a name collision occurs (extremely unlikely).
    for attempt in 0u64..8 {
        let counter = SHELL_INTEGRATION_COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let dir_name = format!("gw_zdotdir_{}_{}_{}", pid, counter.wrapping_add(attempt), nanos);
        let dir_path = tmp.join(&dir_name);

        // DirBuilder with mode 0700 + recursive=false on the final component:
        // create() fails if the directory already exists → defeats pre-create races.
        let created = std::fs::DirBuilder::new()
            .recursive(false)
            .mode(0o700)
            .create(&dir_path);

        match created {
            Ok(()) => {
                // Write .zshenv (sources user's real .zshenv before .zshrc runs).
                let zshenv_ok = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(dir_path.join(".zshenv"))
                    .ok()
                    .and_then(|mut f| f.write_all(zshenv_content.as_bytes()).ok())
                    .is_some();

                let zshrc_ok = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(dir_path.join(".zshrc"))
                    .ok()
                    .and_then(|mut f| f.write_all(zshrc_content.as_bytes()).ok())
                    .is_some();

                if zshenv_ok && zshrc_ok {
                    return Some(dir_path);
                } else {
                    // Partial write — clean up and give up.
                    let _ = std::fs::remove_dir_all(&dir_path);
                    return None;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                // Name collision — try again.
                continue;
            }
            Err(_) => return None,
        }
    }
    None
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

    pub fn create_shell(
        &self,
        session_id: &str,
        app_handle: AppHandle,
        rows: u16,
        cols: u16,
        shell_name: Option<String>,
        working_dir: Option<String>,
        charset: Option<String>,
        shell_integration: bool,
    ) -> Result<(), String> {
        self.close_pty(session_id);

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = resolve_shell(shell_name.as_deref(), shell_integration);

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
