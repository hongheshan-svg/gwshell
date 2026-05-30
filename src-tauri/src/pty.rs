use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct ShellEntry {
    pub id: String,
    pub label: String,
}

pub struct PtyInstance {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
    charset: String,
}

pub struct PtyManager {
    instances: Mutex<HashMap<String, Arc<Mutex<PtyInstance>>>>,
}

#[cfg(target_os = "windows")]
fn resolve_shell(name: Option<&str>) -> CommandBuilder {
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
        _ => CommandBuilder::new("bash"),
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
            instances: Mutex::new(HashMap::new()),
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

        let instance = Arc::new(Mutex::new(PtyInstance {
            master: pair.master,
            child,
            writer,
            charset: charset_str.clone(),
        }));

        self.instances
            .lock()
            .insert(session_id.to_string(), instance);

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

        Ok(())
    }

    pub fn write_to_pty(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        // Clone the Arc under a brief map lock, then release it before doing the
        // (potentially blocking) write+flush — never hold the global map lock
        // across I/O, or one stalled shell freezes input to every other session.
        let instance = self.instances.lock().get(session_id).cloned();
        if let Some(instance) = instance {
            let mut inst = instance.lock();
            // Encode UTF-8 input to the session's target charset before writing
            let bytes: std::borrow::Cow<[u8]> = {
                let enc = encoding_rs::Encoding::for_label(inst.charset.as_bytes())
                    .unwrap_or(encoding_rs::UTF_8);
                if enc == encoding_rs::UTF_8 {
                    std::borrow::Cow::Borrowed(data)
                } else {
                    let text = std::str::from_utf8(data).map_err(|e| e.to_string())?;
                    let (encoded, _enc, _had_unmappable) = enc.encode(text);
                    std::borrow::Cow::Owned(encoded.into_owned())
                }
            };
            inst.writer
                .write_all(&bytes)
                .map_err(|e| format!("Write failed: {}", e))?;
            inst.writer
                .flush()
                .map_err(|e| format!("Flush failed: {}", e))?;
            Ok(())
        } else {
            Err("Session not found".to_string())
        }
    }

    pub fn resize_pty(&self, session_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let instance = self.instances.lock().get(session_id).cloned();
        if let Some(instance) = instance {
            let inst = instance.lock();
            inst.master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| format!("Resize failed: {}", e))?;
            Ok(())
        } else {
            Err("Session not found".to_string())
        }
    }

    pub fn close_pty(&self, session_id: &str) {
        // Remove under a brief lock, then kill+wait off-lock: child.wait() blocks
        // until the process exits and must never be held under the global map
        // mutex, or a slow-dying shell freezes input to every other session.
        let instance = self.instances.lock().remove(session_id);
        if let Some(instance) = instance {
            let mut inst = instance.lock();
            let _ = inst.child.kill();
            let _ = inst.child.wait();
        }
    }

    pub fn close_all(&self) {
        let instances: Vec<_> = self.instances.lock().drain().map(|(_, v)| v).collect();
        for instance in instances {
            let mut inst = instance.lock();
            let _ = inst.child.kill();
            let _ = inst.child.wait();
        }
    }
}
