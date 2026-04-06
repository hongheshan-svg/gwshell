use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use ssh2::{HashType, KeyboardInteractivePrompt, Prompt, Session};
use std::collections::HashMap;
use std::fs;
use std::io::{self, ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// === Known-hosts storage ===

#[derive(Debug, Serialize, Deserialize)]
struct KnownHostEntry {
    fingerprint: String,
    key_type: String,
}

fn known_hosts_path() -> Option<std::path::PathBuf> {
    dirs::data_local_dir().map(|d| d.join("gwshell").join("known_hosts.json"))
}

fn load_known_hosts() -> HashMap<String, KnownHostEntry> {
    known_hosts_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_known_hosts(hosts: &HashMap<String, KnownHostEntry>) {
    if let Some(path) = known_hosts_path() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(hosts) {
            let _ = fs::write(path, json);
        }
    }
}

/// Persist a trusted fingerprint for the given host:port.
pub fn trust_host(host: &str, port: u16, fingerprint: &str, key_type: &str) {
    let key = format!("{}:{}", host, port);
    let mut hosts = load_known_hosts();
    hosts.insert(
        key,
        KnownHostEntry {
            fingerprint: fingerprint.to_string(),
            key_type: key_type.to_string(),
        },
    );
    save_known_hosts(&hosts);
}

/// Check the session's host key against our known_hosts store.
/// Returns:
///   Ok(())                               鈥?known & trusted
///   Err("FINGERPRINT_UNKNOWN:SHA256:...:type")  鈥?never seen before
///   Err("FINGERPRINT_MISMATCH:SHA256:...:type") 鈥?key changed (MITM risk)
fn check_fingerprint(session: &Session, host: &str, port: u16) -> Result<(), String> {
    let hash = session
        .host_key_hash(HashType::Sha256)
        .ok_or_else(|| "FINGERPRINT_ERROR:Could not read host fingerprint".to_string())?;
    let fingerprint = format!("SHA256:{}", BASE64.encode(hash));

    let key_type = if let Some((_, kt)) = session.host_key() {
        format!("{:?}", kt)
    } else {
        "unknown".to_string()
    };

    let store_key = format!("{}:{}", host, port);
    let hosts = load_known_hosts();

    match hosts.get(&store_key) {
        Some(entry) if entry.fingerprint == fingerprint => Ok(()),
        Some(_) => Err(format!("FINGERPRINT_MISMATCH:{}:{}", fingerprint, key_type)),
        None => Err(format!("FINGERPRINT_UNKNOWN:{}:{}", fingerprint, key_type)),
    }
}

// === Keyboard-interactive auth callback ===

struct KbInteractiveAuth {
    password: Option<String>,
    totp_code: Option<String>,
    call_count: usize,
}

impl KeyboardInteractivePrompt for KbInteractiveAuth {
    fn prompt(
        &mut self,
        _username: &str,
        _instructions: &str,
        prompts: &[Prompt<'_>],
    ) -> Vec<String> {
        self.call_count += 1;
        prompts
            .iter()
            .enumerate()
            .map(|(i, _)| {
                if self.call_count == 1 {
                    match i {
                        0 => self.password.clone().unwrap_or_default(),
                        _ => self.totp_code.clone().unwrap_or_default(),
                    }
                } else {
                    self.totp_code.clone().unwrap_or_default()
                }
            })
            .collect()
    }
}

// === TCP connection helpers ===

fn tcp_direct(host: &str, port: u16, timeout_secs: u32) -> Result<TcpStream, String> {
    let addr = format!("{}:{}", host, port);
    if timeout_secs > 0 {
        use std::net::ToSocketAddrs;
        let addrs: Vec<_> = addr
            .to_socket_addrs()
            .map_err(|e| format!("DNS resolution failed for {}: {}", addr, e))?
            .collect();
        for sa in &addrs {
            if let Ok(s) = TcpStream::connect_timeout(sa, Duration::from_secs(timeout_secs as u64))
            {
                return Ok(s);
            }
        }
        Err(format!("Connection to {} timed out ({}s)", addr, timeout_secs))
    } else {
        TcpStream::connect(&addr).map_err(|e| format!("Connection to {} failed: {}", addr, e))
    }
}

fn tcp_socks5(
    proxy_host: &str,
    proxy_port: u16,
    proxy_user: Option<&str>,
    proxy_pass: Option<&str>,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, String> {
    let proxy = format!("{}:{}", proxy_host, proxy_port);
    let target = format!("{}:{}", target_host, target_port);
    let stream = match (proxy_user, proxy_pass) {
        (Some(u), Some(p)) => {
            socks::Socks5Stream::connect_with_password(&proxy.as_str(), target.as_str(), u, p)
                .map_err(|e| format!("SOCKS5 proxy failed: {}", e))?
        }
        _ => socks::Socks5Stream::connect(&proxy.as_str(), target.as_str())
            .map_err(|e| format!("SOCKS5 proxy failed: {}", e))?,
    };
    Ok(stream.into_inner())
}

fn tcp_http_connect(
    proxy_host: &str,
    proxy_port: u16,
    proxy_user: Option<&str>,
    proxy_pass: Option<&str>,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, String> {
    let mut stream = TcpStream::connect(format!("{}:{}", proxy_host, proxy_port))
        .map_err(|e| format!("HTTP proxy connection failed: {}", e))?;

    let mut req = format!(
        "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n",
        target_host, target_port, target_host, target_port
    );
    if let (Some(u), Some(p)) = (proxy_user, proxy_pass) {
        let creds = BASE64.encode(format!("{}:{}", u, p).as_bytes());
        req.push_str(&format!("Proxy-Authorization: Basic {}\r\n", creds));
    }
    req.push_str("\r\n");

    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("HTTP CONNECT request failed: {}", e))?;

    let mut response = vec![0u8; 4096];
    let n = stream
        .read(&mut response)
        .map_err(|e| format!("HTTP proxy response failed: {}", e))?;
    let resp_str = String::from_utf8_lossy(&response[..n]);
    if !resp_str.contains("200") {
        return Err(format!(
            "HTTP proxy refused: {}",
            resp_str.lines().next().unwrap_or("")
        ));
    }
    Ok(stream)
}

/// Establish a TCP stream routed through a jump host via SSH direct-tcpip.
/// Spawns a forwarder thread that bridges the local loopback socket to the
/// jump host's direct-tcpip channel.
fn tcp_via_jump(
    jump_host: &str,
    jump_port: u16,
    jump_username: &str,
    jump_password: Option<&str>,
    jump_private_key_path: Option<&str>,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, String> {
    let jump_tcp = TcpStream::connect(format!("{}:{}", jump_host, jump_port))
        .map_err(|e| format!("Jump host connection failed: {}", e))?;

    let mut jump_sess = Session::new()
        .map_err(|e| format!("Jump session creation failed: {}", e))?;
    jump_sess.set_tcp_stream(jump_tcp);
    jump_sess
        .handshake()
        .map_err(|e| format!("Jump handshake failed: {}", e))?;

    if let Some(key_path) = jump_private_key_path.filter(|s| !s.is_empty()) {
        jump_sess
            .userauth_pubkey_file(jump_username, None, Path::new(key_path), jump_password)
            .map_err(|e| format!("Jump key auth failed: {}", e))?;
    } else if let Some(pwd) = jump_password.filter(|s| !s.is_empty()) {
        jump_sess
            .userauth_password(jump_username, pwd)
            .map_err(|e| format!("Jump password auth failed: {}", e))?;
    } else {
        return Err("No jump host authentication credentials provided".to_string());
    }

    if !jump_sess.authenticated() {
        return Err("Jump host authentication failed".to_string());
    }

    jump_sess.set_blocking(true);
    let mut jump_ch = jump_sess
        .channel_direct_tcpip(target_host, target_port, None)
        .map_err(|e| format!("Jump direct-tcpip channel failed: {}", e))?;

    // Bind a local loopback port; the forwarder thread will accept exactly one
    // connection and bridge it to the jump channel.
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Jump proxy listener bind failed: {}", e))?;
    let local_addr = listener
        .local_addr()
        .map_err(|e| format!("Jump proxy local addr failed: {}", e))?;

    std::thread::spawn(move || {
        if let Ok((mut local, _)) = listener.accept() {
            local.set_nonblocking(true).ok();
            jump_sess.set_blocking(false);

            let mut buf_ch = [0u8; 8192];
            let mut buf_lo = [0u8; 8192];

            loop {
                let mut active = false;

                // Jump channel 鈫?local socket
                match jump_ch.read(&mut buf_ch) {
                    Ok(0) => break,
                    Ok(n) => {
                        if local.write_all(&buf_ch[..n]).is_err() {
                            break;
                        }
                        active = true;
                    }
                    Err(ref e) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(_) => break,
                }

                // Local socket 鈫?jump channel
                match local.read(&mut buf_lo) {
                    Ok(0) => break,
                    Ok(n) => {
                        jump_sess.set_blocking(true);
                        if jump_ch.write_all(&buf_lo[..n]).is_err() {
                            break;
                        }
                        let _ = jump_ch.flush();
                        jump_sess.set_blocking(false);
                        active = true;
                    }
                    Err(ref e) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(_) => break,
                }

                if !active {
                    std::thread::sleep(Duration::from_millis(2));
                }
            }

            jump_sess.set_blocking(true);
            let _ = jump_ch.close();
            let _ = jump_ch.wait_close();
        }
    });

    // Connect from the main thread to the local proxy port.
    TcpStream::connect(local_addr)
        .map_err(|e| format!("Connect to jump proxy failed: {}", e))
}

// === SshInstance / SshManager ===

pub struct SshInstance {
    session: Session,
    channel: ssh2::Channel,
    sftp: Option<ssh2::Sftp>,
}

#[derive(Debug, Serialize, Clone)]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
    pub permissions: Option<u32>,
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

    #[allow(clippy::too_many_arguments)]
    pub fn connect(
        &self,
        session_id: &str,
        host: &str,
        port: u16,
        username: &str,
        password: Option<&str>,
        private_key_path: Option<&str>,
        auth_method: &str,
        totp_code: Option<&str>,
        jump_host: Option<&str>,
        jump_port: u16,
        jump_username: Option<&str>,
        jump_password: Option<&str>,
        jump_private_key_path: Option<&str>,
        proxy_type: Option<&str>,
        proxy_host: Option<&str>,
        proxy_port: u16,
        proxy_username: Option<&str>,
        proxy_password: Option<&str>,
        connection_timeout: u32,
        app_handle: AppHandle,
        rows: u32,
        cols: u32,
    ) -> Result<(), String> {
        // == Step 1: establish raw TCP stream ==
        let tcp = if let Some(jh) = jump_host.filter(|h| !h.is_empty()) {
            tcp_via_jump(
                jh,
                jump_port,
                jump_username.unwrap_or(username),
                jump_password.or(password),
                jump_private_key_path,
                host,
                port,
            )?
        } else {
            match proxy_type.unwrap_or("none") {
                "socks5" => tcp_socks5(
                    proxy_host.unwrap_or(""),
                    proxy_port,
                    proxy_username,
                    proxy_password,
                    host,
                    port,
                )?,
                "http" => tcp_http_connect(
                    proxy_host.unwrap_or(""),
                    proxy_port,
                    proxy_username,
                    proxy_password,
                    host,
                    port,
                )?,
                _ => tcp_direct(host, port, connection_timeout)?,
            }
        };

        // == Step 2: SSH handshake ==
        let mut session =
            Session::new().map_err(|e| format!("Session creation failed: {}", e))?;
        session.set_tcp_stream(tcp);
        session
            .handshake()
            .map_err(|e| format!("Handshake failed: {}", e))?;

        // == Step 3: fingerprint verification ==
        check_fingerprint(&session, host, port)?;

        // == Step 4: authenticate ==
        match auth_method {
            "publickey" => {
                let key_path = private_key_path.ok_or("Private key path is required")?;
                session
                    .userauth_pubkey_file(username, None, Path::new(key_path), password)
                    .map_err(|e| format!("Public key auth failed: {}", e))?;
            }
            "keyboardinteractive" => {
                let mut prompter = KbInteractiveAuth {
                    password: password.map(str::to_string),
                    totp_code: totp_code.map(str::to_string),
                    call_count: 0,
                };
                session
                    .userauth_keyboard_interactive(username, &mut prompter)
                    .map_err(|e| format!("Keyboard-interactive auth failed: {}", e))?;
            }
            "agent" => {
                session
                    .userauth_agent(username)
                    .map_err(|e| format!("SSH Agent auth failed: {}", e))?;
            }
            "none" => {
                // Attempt password auth with empty credentials; server decides.
                let _ = session.userauth_password(username, "");
            }
            _ => {
                // Default: password
                let pwd = password.unwrap_or("");
                session
                    .userauth_password(username, pwd)
                    .map_err(|e| format!("Password auth failed: {}", e))?;
            }
        }

        if !session.authenticated() {
            return Err("Authentication failed".to_string());
        }

        // == Step 5: open PTY + shell channel ==
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

        let instance = Arc::new(Mutex::new(SshInstance { session, channel, sftp: None }));
        let reader_instance = instance.clone();

        self.instances
            .lock()
            .insert(session_id.to_string(), instance);

        // == Step 6: reader thread ==
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
                    Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(10));
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

    // ---- SFTP operations ----

    /// Helper: acquire instance, set blocking, ensure SFTP subsystem, run closure, set non-blocking.
    fn with_sftp<T, F>(&self, session_id: &str, f: F) -> Result<T, String>
    where
        F: FnOnce(&ssh2::Sftp) -> Result<T, String>,
    {
        let instance = {
            let instances = self.instances.lock();
            instances
                .get(session_id)
                .ok_or_else(|| "Session not found".to_string())?
                .clone()
        };
        let mut inst = instance.lock();
        inst.session.set_blocking(true);
        if inst.sftp.is_none() {
            inst.sftp = Some(
                inst.session
                    .sftp()
                    .map_err(|e| format!("SFTP init failed: {}", e))?,
            );
        }
        let result = f(inst.sftp.as_ref().unwrap());
        inst.session.set_blocking(false);
        result
    }

    pub fn sftp_list_dir(&self, session_id: &str, path: &str) -> Result<Vec<SftpEntry>, String> {
        self.with_sftp(session_id, |sftp| {
            let entries = sftp
                .readdir(Path::new(path))
                .map_err(|e| format!("SFTP readdir failed: {}", e))?;

            let mut result: Vec<SftpEntry> = entries
                .into_iter()
                .map(|(pathbuf, stat)| {
                    let name = pathbuf
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let full_path = pathbuf.to_string_lossy().to_string();
                    SftpEntry {
                        name,
                        path: full_path,
                        is_dir: stat.is_dir(),
                        size: stat.size.unwrap_or(0),
                        modified: stat.mtime,
                        permissions: stat.perm,
                    }
                })
                .collect();

            // Sort: directories first, then alphabetically
            result.sort_by(|a, b| {
                b.is_dir
                    .cmp(&a.is_dir)
                    .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            });

            Ok(result)
        })
    }

    pub fn sftp_realpath(&self, session_id: &str, path: &str) -> Result<String, String> {
        self.with_sftp(session_id, |sftp| {
            sftp.realpath(Path::new(path))
                .map(|p| p.to_string_lossy().to_string())
                .map_err(|e| format!("SFTP realpath failed: {}", e))
        })
    }

    pub fn sftp_mkdir(&self, session_id: &str, path: &str) -> Result<(), String> {
        self.with_sftp(session_id, |sftp| {
            sftp.mkdir(Path::new(path), 0o755)
                .map_err(|e| format!("SFTP mkdir failed: {}", e))
        })
    }

    pub fn sftp_rmdir(&self, session_id: &str, path: &str) -> Result<(), String> {
        self.with_sftp(session_id, |sftp| {
            sftp.rmdir(Path::new(path))
                .map_err(|e| format!("SFTP rmdir failed: {}", e))
        })
    }

    pub fn sftp_delete_file(&self, session_id: &str, path: &str) -> Result<(), String> {
        self.with_sftp(session_id, |sftp| {
            sftp.unlink(Path::new(path))
                .map_err(|e| format!("SFTP delete failed: {}", e))
        })
    }

    pub fn sftp_rename(
        &self,
        session_id: &str,
        old_path: &str,
        new_path: &str,
    ) -> Result<(), String> {
        self.with_sftp(session_id, |sftp| {
            sftp.rename(Path::new(old_path), Path::new(new_path), None)
                .map_err(|e| format!("SFTP rename failed: {}", e))
        })
    }

    pub fn sftp_download(
        &self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
    ) -> Result<(), String> {
        self.with_sftp(session_id, |sftp| {
            let mut remote_file = sftp
                .open(Path::new(remote_path))
                .map_err(|e| format!("SFTP open failed: {}", e))?;
            let mut buf = Vec::new();
            remote_file
                .read_to_end(&mut buf)
                .map_err(|e| format!("SFTP read failed: {}", e))?;
            fs::write(local_path, &buf)
                .map_err(|e| format!("Local write failed: {}", e))?;
            Ok(())
        })
    }

    pub fn sftp_read_text(
        &self,
        session_id: &str,
        remote_path: &str,
    ) -> Result<String, String> {
        self.with_sftp(session_id, |sftp| {
            let mut remote_file = sftp
                .open(Path::new(remote_path))
                .map_err(|e| format!("SFTP open failed: {}", e))?;
            let mut buf = Vec::new();
            remote_file
                .read_to_end(&mut buf)
                .map_err(|e| format!("SFTP read failed: {}", e))?;
            String::from_utf8(buf)
                .map_err(|_| "File is not valid UTF-8 text".to_string())
        })
    }

    pub fn sftp_write_text(
        &self,
        session_id: &str,
        remote_path: &str,
        content: &str,
    ) -> Result<(), String> {
        self.with_sftp(session_id, |sftp| {
            let mut remote_file = sftp
                .create(Path::new(remote_path))
                .map_err(|e| format!("SFTP create failed: {}", e))?;
            remote_file
                .write_all(content.as_bytes())
                .map_err(|e| format!("SFTP write failed: {}", e))?;
            Ok(())
        })
    }

    pub fn sftp_upload(
        &self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
    ) -> Result<(), String> {
        self.with_sftp(session_id, |sftp| {
            let data =
                fs::read(local_path).map_err(|e| format!("Local read failed: {}", e))?;
            let mut remote_file = sftp
                .create(Path::new(remote_path))
                .map_err(|e| format!("SFTP create failed: {}", e))?;
            remote_file
                .write_all(&data)
                .map_err(|e| format!("SFTP write failed: {}", e))?;
            Ok(())
        })
    }

    pub fn sftp_chmod(
        &self,
        session_id: &str,
        path: &str,
        mode: u32,
    ) -> Result<(), String> {
        self.with_sftp(session_id, |sftp| {
            let mut stat = sftp
                .stat(Path::new(path))
                .map_err(|e| format!("SFTP stat failed: {}", e))?;
            stat.perm = Some(mode);
            sftp.setstat(Path::new(path), stat)
                .map_err(|e| format!("SFTP chmod failed: {}", e))
        })
    }

    pub fn sftp_create_file(&self, session_id: &str, path: &str) -> Result<(), String> {
        self.with_sftp(session_id, |sftp| {
            let _file = sftp
                .create(Path::new(path))
                .map_err(|e| format!("SFTP create file failed: {}", e))?;
            Ok(())
        })
    }

    /// Execute a command via a new SSH channel and return stdout.
    pub fn ssh_exec(&self, session_id: &str, command: &str) -> Result<String, String> {
        let instance = {
            let instances = self.instances.lock();
            instances
                .get(session_id)
                .ok_or_else(|| "Session not found".to_string())?
                .clone()
        };
        let inst = instance.lock();
        inst.session.set_blocking(true);
        let mut ch = inst
            .session
            .channel_session()
            .map_err(|e| format!("Exec channel failed: {}", e))?;
        ch.exec(command)
            .map_err(|e| format!("Exec failed: {}", e))?;
        let mut output = String::new();
        ch.read_to_string(&mut output)
            .map_err(|e| format!("Exec read failed: {}", e))?;
        ch.wait_close()
            .map_err(|e| format!("Exec close failed: {}", e))?;
        inst.session.set_blocking(false);
        Ok(output.trim().to_string())
    }

    /// Start a local-forward tunnel: each connection to 127.0.0.1:local_port is
    /// forwarded to remote_host:remote_port through a *new* dedicated SSH session.
    /// Returns the actual bound local port (useful when local_port == 0).
    #[allow(clippy::too_many_arguments)]
    pub fn start_local_forward(
        &self,
        host: &str,
        port: u16,
        username: &str,
        password: Option<&str>,
        private_key_path: Option<&str>,
        auth_method: &str,
        jump_host: Option<&str>,
        jump_port: u16,
        jump_username: Option<&str>,
        jump_password: Option<&str>,
        jump_private_key_path: Option<&str>,
        proxy_type: Option<&str>,
        proxy_host: Option<&str>,
        proxy_port: u16,
        proxy_username: Option<&str>,
        proxy_password: Option<&str>,
        local_port: u16,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<u16, String> {
        // Bind local listener first so caller gets the actual port immediately.
        let listener = TcpListener::bind(format!("127.0.0.1:{}", local_port))
            .map_err(|e| format!("Tunnel bind 127.0.0.1:{} failed: {}", local_port, e))?;
        let actual_port = listener
            .local_addr()
            .map_err(|e| format!("Tunnel get port failed: {}", e))?
            .port();

        // Snapshot everything needed by the background thread.
        let host = host.to_string();
        let username = username.to_string();
        let password = password.map(str::to_string);
        let private_key_path = private_key_path.map(str::to_string);
        let auth_method = auth_method.to_string();
        let jump_host = jump_host.map(str::to_string);
        let jump_username = jump_username.map(str::to_string);
        let jump_password = jump_password.map(str::to_string);
        let jump_private_key_path = jump_private_key_path.map(str::to_string);
        let proxy_type_owned = proxy_type.map(str::to_string);
        let proxy_host = proxy_host.map(str::to_string);
        let proxy_username = proxy_username.map(str::to_string);
        let proxy_password = proxy_password.map(str::to_string);
        let remote_host = remote_host.to_string();

        std::thread::spawn(move || {
            for client in listener.incoming() {
                let Ok(client_stream) = client else {
                    continue;
                };

                // Create a dedicated SSH session for this tunnel connection.
                let tcp_result = if let Some(ref jh) = jump_host.clone().filter(|h| !h.is_empty())
                {
                    tcp_via_jump(
                        jh,
                        jump_port,
                        jump_username.as_deref().unwrap_or(&username),
                        jump_password.as_deref().or(password.as_deref()),
                        jump_private_key_path.as_deref(),
                        &host,
                        port,
                    )
                } else {
                    match proxy_type_owned.as_deref().unwrap_or("none") {
                        "socks5" => tcp_socks5(
                            proxy_host.as_deref().unwrap_or(""),
                            proxy_port,
                            proxy_username.as_deref(),
                            proxy_password.as_deref(),
                            &host,
                            port,
                        ),
                        "http" => tcp_http_connect(
                            proxy_host.as_deref().unwrap_or(""),
                            proxy_port,
                            proxy_username.as_deref(),
                            proxy_password.as_deref(),
                            &host,
                            port,
                        ),
                        _ => tcp_direct(&host, port, 30),
                    }
                };

                let Ok(tcp) = tcp_result else {
                    continue;
                };

                let Ok(mut tun_sess) = Session::new() else {
                    continue;
                };
                tun_sess.set_tcp_stream(tcp);
                if tun_sess.handshake().is_err() {
                    continue;
                }

                // Authenticate (reuse same credentials).
                let authed = match auth_method.as_str() {
                    "publickey" => {
                        if let Some(ref kp) = private_key_path {
                            tun_sess
                                .userauth_pubkey_file(
                                    &username,
                                    None,
                                    Path::new(kp),
                                    password.as_deref(),
                                )
                                .is_ok()
                        } else {
                            false
                        }
                    }
                    "agent" => tun_sess.userauth_agent(&username).is_ok(),
                    _ => {
                        if let Some(ref pwd) = password {
                            tun_sess.userauth_password(&username, pwd).is_ok()
                        } else {
                            false
                        }
                    }
                };

                if !authed || !tun_sess.authenticated() {
                    continue;
                }

                tun_sess.set_blocking(true);
                let Ok(fwd_ch) = tun_sess.channel_direct_tcpip(&remote_host, remote_port, None)
                else {
                    continue;
                };

                // Wrap together so both threads can serialise access.
                struct TunnelConn {
                    session: Session,
                    channel: ssh2::Channel,
                }
                let conn = Arc::new(Mutex::new(TunnelConn {
                    session: tun_sess,
                    channel: fwd_ch,
                }));

                // Set channel non-blocking once.
                {
                    let c = conn.lock();
                    c.session.set_blocking(false);
                }

                let mut local_write = client_stream
                    .try_clone()
                    .expect("TcpStream clone for tunnel write");
                let mut local_read = client_stream;

                let conn_r = conn.clone();

                // Reader thread: SSH channel 鈫?local socket
                std::thread::spawn(move || {
                    let mut buf = [0u8; 8192];
                    loop {
                        let result = {
                            let mut c = conn_r.lock();
                            c.channel.read(&mut buf)
                        };
                        match result {
                            Ok(0) => break,
                            Ok(n) => {
                                if local_write.write_all(&buf[..n]).is_err() {
                                    break;
                                }
                            }
                            Err(ref e) if e.kind() == ErrorKind::WouldBlock => {
                                std::thread::sleep(Duration::from_millis(5));
                            }
                            Err(_) => break,
                        }
                    }
                });

                // Writer thread: local socket 鈫?SSH channel
                std::thread::spawn(move || {
                    let mut buf = [0u8; 8192];
                    loop {
                        match local_read.read(&mut buf) {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                let mut c = conn.lock();
                                c.session.set_blocking(true);
                                if c.channel.write_all(&buf[..n]).is_err() {
                                    break;
                                }
                                let _ = c.channel.flush();
                                c.session.set_blocking(false);
                            }
                        }
                    }
                });
            }
        });

        Ok(actual_port)
    }
}


