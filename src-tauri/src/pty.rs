use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub struct PtyInstance {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

pub struct PtyManager {
    instances: Mutex<HashMap<String, Arc<Mutex<PtyInstance>>>>,
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
        shell_path: Option<String>,
        working_dir: Option<String>,
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

        let mut cmd = if let Some(ref path) = shell_path {
            CommandBuilder::new(path)
        } else {
            #[cfg(target_os = "windows")]
            {
                let mut cmd = CommandBuilder::new("powershell.exe");
                cmd.arg("-NoLogo");
                cmd
            }
            #[cfg(not(target_os = "windows"))]
            {
                CommandBuilder::new("bash")
            }
        };

        if let Some(ref dir) = working_dir {
            cmd.cwd(std::path::Path::new(dir));
        } else if let Some(home) = dirs::home_dir() {
            cmd.cwd(home);
        }

        pair.slave
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
            writer,
        }));

        self.instances
            .lock()
            .insert(session_id.to_string(), instance);

        let sid = session_id.to_string();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let _ = app_handle.emit(&format!("pty-exit-{}", sid), ());
                        break;
                    }
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_handle.emit(&format!("pty-data-{}", sid), data);
                    }
                    Err(_) => {
                        let _ = app_handle.emit(&format!("pty-exit-{}", sid), ());
                        break;
                    }
                }
            }
        });

        Ok(())
    }

    pub fn write_to_pty(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let instances = self.instances.lock();
        if let Some(instance) = instances.get(session_id) {
            let mut inst = instance.lock();
            inst.writer
                .write_all(data)
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
        let instances = self.instances.lock();
        if let Some(instance) = instances.get(session_id) {
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
        self.instances.lock().remove(session_id);
    }
}
