use parking_lot::Mutex;
use ssh2::Session;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub struct SshInstance {
    session: Session,
    channel: ssh2::Channel,
}

pub struct SshManager {
    instances: Mutex<HashMap<String, Arc<Mutex<SshInstance>>>>,
}

impl SshManager {
    pub fn new() -> Self {
        Self {
            instances: Mutex::new(HashMap::new()),
        }
    }

    pub fn connect(
        &self,
        session_id: &str,
        host: &str,
        port: u16,
        username: &str,
        password: Option<&str>,
        private_key_path: Option<&str>,
        app_handle: AppHandle,
        rows: u32,
        cols: u32,
    ) -> Result<(), String> {
        let tcp = TcpStream::connect(format!("{}:{}", host, port))
            .map_err(|e| format!("Connection failed: {}", e))?;

        let mut session = Session::new().map_err(|e| format!("Session creation failed: {}", e))?;
        session.set_tcp_stream(tcp);
        session
            .handshake()
            .map_err(|e| format!("Handshake failed: {}", e))?;

        if let Some(key_path) = private_key_path {
            session
                .userauth_pubkey_file(username, None, std::path::Path::new(key_path), password)
                .map_err(|e| format!("Public key auth failed: {}", e))?;
        } else if let Some(pwd) = password {
            session
                .userauth_password(username, pwd)
                .map_err(|e| format!("Password auth failed: {}", e))?;
        } else {
            return Err("No authentication method provided".to_string());
        }

        if !session.authenticated() {
            return Err("Authentication failed".to_string());
        }

        let mut channel = session
            .channel_session()
            .map_err(|e| format!("Channel open failed: {}", e))?;

        channel
            .request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))
            .map_err(|e| format!("PTY request failed: {}", e))?;

        channel
            .shell()
            .map_err(|e| format!("Shell request failed: {}", e))?;

        session.set_blocking(false);

        let reader_channel = session
            .channel_session()
            .ok();
        drop(reader_channel);

        let instance = Arc::new(Mutex::new(SshInstance { session, channel }));
        let reader_instance = instance.clone();

        self.instances
            .lock()
            .insert(session_id.to_string(), instance);

        let sid = session_id.to_string();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                let result = {
                    let mut inst = reader_instance.lock();
                    inst.channel.read(&mut buf)
                };
                match result {
                    Ok(0) => {
                        let _ = app_handle.emit(&format!("ssh-exit-{}", sid), ());
                        break;
                    }
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_handle.emit(&format!("ssh-data-{}", sid), data);
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                    Err(_) => {
                        let _ = app_handle.emit(&format!("ssh-exit-{}", sid), ());
                        break;
                    }
                }
            }
        });

        Ok(())
    }

    pub fn write_to_ssh(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let instances = self.instances.lock();
        if let Some(instance) = instances.get(session_id) {
            let mut inst = instance.lock();
            inst.session.set_blocking(true);
            let result = inst
                .channel
                .write_all(data)
                .map_err(|e| format!("Write failed: {}", e));
            let _ = inst.channel.flush();
            inst.session.set_blocking(false);
            result
        } else {
            Err("Session not found".to_string())
        }
    }

    pub fn resize_ssh(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        let instances = self.instances.lock();
        if let Some(instance) = instances.get(session_id) {
            let mut inst = instance.lock();
            inst.session.set_blocking(true);
            let result = inst
                .channel
                .request_pty_size(cols, rows, None, None)
                .map_err(|e| format!("Resize failed: {}", e));
            inst.session.set_blocking(false);
            result
        } else {
            Err("Session not found".to_string())
        }
    }

    pub fn close_ssh(&self, session_id: &str) {
        if let Some(instance) = self.instances.lock().remove(session_id) {
            let mut inst = instance.lock();
            inst.session.set_blocking(true);
            let _ = inst.channel.close();
            let _ = inst.channel.wait_close();
        }
    }
}
