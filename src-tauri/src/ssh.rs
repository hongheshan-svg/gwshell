use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use ssh2::{HashType, KeyboardInteractivePrompt, Prompt, Session};
use std::collections::HashMap;
use std::fs;
use std::io::{self, ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::mpsc;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Expand a leading `~` or `~/` into the user's home directory.
/// Other forms (`~user/...`) are returned unchanged — libssh2 doesn't
/// support them either, so we keep behavior predictable.
fn expand_tilde(path: &str) -> std::path::PathBuf {
    use std::path::PathBuf;
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

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
        Err(format!(
            "Connection to {} timed out ({}s)",
            addr, timeout_secs
        ))
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

    let mut jump_sess =
        Session::new().map_err(|e| format!("Jump session creation failed: {}", e))?;
    jump_sess.set_tcp_stream(jump_tcp);
    jump_sess
        .handshake()
        .map_err(|e| format!("Jump handshake failed: {}", e))?;

    if let Some(key_path_raw) = jump_private_key_path.filter(|s| !s.is_empty()) {
        let key_path = expand_tilde(key_path_raw);
        if !key_path.exists() {
            return Err(format!("Jump host key file not found: {}", key_path.display()));
        }
        jump_sess
            .userauth_pubkey_file(jump_username, None, &key_path, jump_password)
            .map_err(|e| format!("Jump key auth failed ({}): {}", key_path.display(), e))?;
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
    TcpStream::connect(local_addr).map_err(|e| format!("Connect to jump proxy failed: {}", e))
}

// === SshInstance / SshManager ===

/// Decode accumulated raw bytes through a streaming decoder and emit them as a
/// single batched event. The decoder keeps incomplete multi-byte sequences
/// between calls, so a UTF-8/CJK character split across read boundaries is no
/// longer corrupted into U+FFFD. Pass `last = true` on EOF/disconnect to flush
/// any trailing state.
fn flush_decoded(
    decoder: &mut encoding_rs::Decoder,
    pending: &mut Vec<u8>,
    app: &AppHandle,
    ev: &str,
    last: bool,
) {
    if pending.is_empty() && !last {
        return;
    }
    let mut out = String::with_capacity(pending.len() + 16);
    let _ = decoder.decode_to_string(pending.as_slice(), &mut out, last);
    pending.clear();
    if !out.is_empty() {
        let _ = app.emit(ev, out);
    }
}

pub struct SshInstance {
    session: Session,
    channel: ssh2::Channel,
    sftp: Option<ssh2::Sftp>,
}

/// Commands sent to a session's owner thread. The owner thread is the *sole*
/// thread that reads from and writes to the interactive channel, so input,
/// resize and teardown never contend with the read loop for a lock and never
/// hold the global instance map lock across blocking network I/O.
enum SshCmd {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
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

/// Everything needed to (re)establish an authenticated SSH session. Captured at
/// connect time so an auxiliary connection can be opened lazily for SFTP/metrics.
#[derive(Clone)]
struct ConnectParams {
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    auth_method: String,
    totp_code: Option<String>,
    jump_host: Option<String>,
    jump_port: u16,
    jump_username: Option<String>,
    jump_password: Option<String>,
    jump_private_key_path: Option<String>,
    proxy_type: Option<String>,
    proxy_host: Option<String>,
    proxy_port: u16,
    proxy_username: Option<String>,
    proxy_password: Option<String>,
    connection_timeout: u32,
}

/// An auxiliary SSH connection (its own TCP socket + libssh2 session), used for
/// SFTP transfers and metrics exec so those long/blocking operations never hold
/// the interactive shell's lock and freeze the terminal. Always blocking-mode.
struct AuxSession {
    session: Session,
    sftp: Option<ssh2::Sftp>,
}

/// Connect steps 1-4: raw TCP (optionally via jump host / proxy), SSH handshake,
/// host-key verification, and authentication. Returns an authenticated, still
/// blocking-mode session. Shared by the interactive connect path and the lazy
/// auxiliary connection used for SFTP/metrics.
fn establish_authenticated_session(p: &ConnectParams) -> Result<Session, String> {
    // == Step 1: establish raw TCP stream ==
    let tcp = if let Some(jh) = p.jump_host.as_deref().filter(|h| !h.is_empty()) {
        tcp_via_jump(
            jh,
            p.jump_port,
            p.jump_username.as_deref().unwrap_or(&p.username),
            p.jump_password.as_deref().or(p.password.as_deref()),
            p.jump_private_key_path.as_deref(),
            &p.host,
            p.port,
        )?
    } else {
        match p.proxy_type.as_deref().unwrap_or("none") {
            "socks5" => tcp_socks5(
                p.proxy_host.as_deref().unwrap_or(""),
                p.proxy_port,
                p.proxy_username.as_deref(),
                p.proxy_password.as_deref(),
                &p.host,
                p.port,
            )?,
            "http" => tcp_http_connect(
                p.proxy_host.as_deref().unwrap_or(""),
                p.proxy_port,
                p.proxy_username.as_deref(),
                p.proxy_password.as_deref(),
                &p.host,
                p.port,
            )?,
            _ => tcp_direct(&p.host, p.port, p.connection_timeout)?,
        }
    };

    // == Step 2: SSH handshake ==
    let mut session = Session::new().map_err(|e| format!("Session creation failed: {}", e))?;
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|e| format!("Handshake failed: {}", e))?;

    // == Step 3: fingerprint verification ==
    check_fingerprint(&session, &p.host, p.port)?;

    // == Step 4: authenticate ==
    match p.auth_method.as_str() {
        "publickey" => {
            let key_path_raw = p
                .private_key_path
                .as_deref()
                .ok_or("Private key path is required")?;
            let key_path = expand_tilde(key_path_raw);
            if !key_path.exists() {
                return Err(format!("SSH key file not found: {}", key_path.display()));
            }
            session
                .userauth_pubkey_file(&p.username, None, &key_path, p.password.as_deref())
                .map_err(|e| format!("Public key auth failed ({}): {}", key_path.display(), e))?;
        }
        "keyboardinteractive" => {
            let mut prompter = KbInteractiveAuth {
                password: p.password.clone(),
                totp_code: p.totp_code.clone(),
                call_count: 0,
            };
            session
                .userauth_keyboard_interactive(&p.username, &mut prompter)
                .map_err(|e| format!("Keyboard-interactive auth failed: {}", e))?;
        }
        "agent" => {
            session
                .userauth_agent(&p.username)
                .map_err(|e| format!("SSH Agent auth failed: {}", e))?;
        }
        "none" => {
            let _ = session.userauth_password(&p.username, "");
        }
        _ => {
            let pwd = p.password.as_deref().unwrap_or("");
            session
                .userauth_password(&p.username, pwd)
                .map_err(|e| format!("Password auth failed: {}", e))?;
        }
    }

    if !session.authenticated() {
        return Err("Authentication failed".to_string());
    }

    Ok(session)
}

pub struct SshManager {
    instances: Mutex<HashMap<String, Arc<Mutex<SshInstance>>>>,
    // Per-session command channel to the owner thread (input/resize/close).
    writers: Mutex<HashMap<String, mpsc::Sender<SshCmd>>>,
    aux: Mutex<HashMap<String, Arc<Mutex<AuxSession>>>>,
    params: Mutex<HashMap<String, ConnectParams>>,
    forwards: Mutex<HashMap<String, LocalForward>>,
}

struct LocalForward {
    stop_flag: Arc<AtomicBool>,
    local_port: u16,
}

impl SshManager {
    pub fn new() -> Self {
        Self {
            instances: Mutex::new(HashMap::new()),
            writers: Mutex::new(HashMap::new()),
            aux: Mutex::new(HashMap::new()),
            params: Mutex::new(HashMap::new()),
            forwards: Mutex::new(HashMap::new()),
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
        idle_disconnect_minutes: u32,
        app_handle: AppHandle,
        rows: u32,
        cols: u32,
    ) -> Result<(), String> {
        // == Steps 1-4: TCP, handshake, fingerprint, auth (shared helper) ==
        let params = ConnectParams {
            host: host.to_string(),
            port,
            username: username.to_string(),
            password: password.map(str::to_string),
            private_key_path: private_key_path.map(str::to_string),
            auth_method: auth_method.to_string(),
            totp_code: totp_code.map(str::to_string),
            jump_host: jump_host.map(str::to_string),
            jump_port,
            jump_username: jump_username.map(str::to_string),
            jump_password: jump_password.map(str::to_string),
            jump_private_key_path: jump_private_key_path.map(str::to_string),
            proxy_type: proxy_type.map(str::to_string),
            proxy_host: proxy_host.map(str::to_string),
            proxy_port,
            proxy_username: proxy_username.map(str::to_string),
            proxy_password: proxy_password.map(str::to_string),
            connection_timeout,
        };

        let session = establish_authenticated_session(&params)?;

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

        // Enable SSH keepalive: send a keepalive packet every 30 seconds
        session.set_keepalive(true, 30);

        session.set_blocking(false);

        let instance = Arc::new(Mutex::new(SshInstance {
            session,
            channel,
            sftp: None,
        }));
        let reader_instance = instance.clone();

        // mpsc command channel: the owner thread is the sole writer of the
        // channel, so input/resize never contend with reads for a lock.
        let (write_tx, write_rx) = mpsc::channel::<SshCmd>();

        self.instances
            .lock()
            .insert(session_id.to_string(), instance);
        self.writers
            .lock()
            .insert(session_id.to_string(), write_tx);
        // Remember how to reconnect so SFTP/metrics can open a dedicated
        // auxiliary connection on demand (see `with_work_session`).
        self.params.lock().insert(session_id.to_string(), params);

        // == Step 6: owner thread (reads + writes + resize + teardown) ==
        let sid = session_id.to_string();
        std::thread::spawn(move || {
            let data_ev = format!("ssh-data-{}", sid);
            let exit_ev = format!("ssh-exit-{}", sid);
            let mut buf = [0u8; 16384];
            // Coalesce bursts of output and flush as one batched event. Emitting
            // one event per 4KB read previously flooded the IPC channel and
            // froze the UI under heavy output (`cat`, build logs, `top`).
            let mut pending: Vec<u8> = Vec::with_capacity(64 * 1024);
            let mut decoder = encoding_rs::UTF_8.new_decoder();
            let mut last_io = Instant::now();
            let mut last_keepalive = Instant::now();
            let mut last_flush = Instant::now();
            let mut last_input = Instant::now();
            const MAX_PENDING: usize = 64 * 1024;
            const FLUSH_INTERVAL: Duration = Duration::from_millis(16);
            'outer: loop {
                let read_result = {
                    let mut inst = reader_instance.lock();

                    // --- Drain queued input/resize/close. This thread is the
                    // sole writer, so a keystroke is just a non-blocking,
                    // bounded write that can never hang the session forever. ---
                    loop {
                        match write_rx.try_recv() {
                            Ok(SshCmd::Data(bytes)) => {
                                last_input = Instant::now();
                                inst.session.set_blocking(false);
                                let mut off = 0;
                                let start = Instant::now();
                                while off < bytes.len() {
                                    match inst.channel.write(&bytes[off..]) {
                                        Ok(0) => break,
                                        Ok(n) => off += n,
                                        Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                                            if start.elapsed() > Duration::from_secs(5) {
                                                break;
                                            }
                                            std::thread::sleep(Duration::from_millis(1));
                                        }
                                        Err(_) => break,
                                    }
                                }
                                let _ = inst.channel.flush();
                                last_io = Instant::now();
                            }
                            Ok(SshCmd::Resize { cols, rows }) => {
                                inst.session.set_blocking(true);
                                let _ = inst.channel.request_pty_size(cols, rows, None, None);
                                inst.session.set_blocking(false);
                            }
                            Ok(SshCmd::Close) => {
                                inst.session.set_blocking(false);
                                let _ = inst.channel.close();
                                break 'outer;
                            }
                            Err(mpsc::TryRecvError::Empty) => break,
                            Err(mpsc::TryRecvError::Disconnected) => {
                                inst.session.set_blocking(false);
                                let _ = inst.channel.close();
                                break 'outer;
                            }
                        }
                    }

                    if idle_disconnect_minutes > 0
                        && last_input.elapsed()
                            >= Duration::from_secs(idle_disconnect_minutes as u64 * 60)
                    {
                        inst.session.set_blocking(true);
                        let _ = inst.channel.close();
                        let _ = inst.channel.wait_close();
                        flush_decoded(&mut decoder, &mut pending, &app_handle, &data_ev, true);
                        let _ = app_handle.emit(&exit_ev, ());
                        break 'outer;
                    }

                    // Keep idle sessions alive. libssh2 keepalive packets are
                    // best sent in blocking mode; in non-blocking mode they
                    // can be skipped as WouldBlock and the server may close an
                    // otherwise healthy idle connection.
                    let keepalive_error = if last_io.elapsed() >= Duration::from_secs(20)
                        && last_keepalive.elapsed() >= Duration::from_secs(20)
                    {
                        inst.session.set_blocking(true);
                        let keepalive_result = inst.session.keepalive_send();
                        inst.session.set_blocking(false);
                        last_keepalive = Instant::now();
                        match keepalive_result {
                            Ok(_) => {
                                last_io = Instant::now();
                                None
                            }
                            Err(e) => Some(io::Error::new(
                                ErrorKind::ConnectionAborted,
                                format!("SSH keepalive failed: {}", e),
                            )),
                        }
                    } else {
                        None
                    };

                    if let Some(e) = keepalive_error {
                        Err(e)
                    } else {
                        inst.channel.read(&mut buf)
                    }
                };
                match read_result {
                    Ok(0) => {
                        flush_decoded(&mut decoder, &mut pending, &app_handle, &data_ev, false);
                        // Check if channel truly closed (EOF)
                        let eof = {
                            let inst = reader_instance.lock();
                            inst.channel.eof()
                        };
                        if eof {
                            flush_decoded(&mut decoder, &mut pending, &app_handle, &data_ev, true);
                            let _ = app_handle.emit(&exit_ev, ());
                            break 'outer;
                        }
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Ok(n) => {
                        last_io = Instant::now();
                        pending.extend_from_slice(&buf[..n]);
                        if pending.len() >= MAX_PENDING || last_flush.elapsed() >= FLUSH_INTERVAL {
                            flush_decoded(&mut decoder, &mut pending, &app_handle, &data_ev, false);
                            last_flush = Instant::now();
                        }
                    }
                    Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                        flush_decoded(&mut decoder, &mut pending, &app_handle, &data_ev, false);
                        last_flush = Instant::now();
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(e) => {
                        // For connection-reset type errors, exit; for others, retry briefly
                        let fatal = matches!(
                            e.kind(),
                            io::ErrorKind::ConnectionReset
                                | io::ErrorKind::ConnectionAborted
                                | io::ErrorKind::BrokenPipe
                                | io::ErrorKind::UnexpectedEof
                        );
                        if fatal {
                            flush_decoded(&mut decoder, &mut pending, &app_handle, &data_ev, true);
                            let _ = app_handle.emit(&exit_ev, ());
                            break 'outer;
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                }
            }
        });

        Ok(())
    }

    pub fn write_to_ssh(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        // Hot path: only briefly lock the map to clone the sender, then enqueue.
        // The owner thread performs the actual (non-blocking) channel write, so
        // a keystroke never blocks and never holds a lock across network I/O.
        let tx = self.writers.lock().get(session_id).cloned();
        match tx {
            Some(tx) => {
                let _ = tx.send(SshCmd::Data(data.to_vec()));
                Ok(())
            }
            None => Err("Session not found".to_string()),
        }
    }

    pub fn resize_ssh(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        let tx = self.writers.lock().get(session_id).cloned();
        match tx {
            Some(tx) => {
                let _ = tx.send(SshCmd::Resize { cols, rows });
                Ok(())
            }
            None => Err("Session not found".to_string()),
        }
    }

    pub fn close_ssh(&self, session_id: &str) {
        self.close_local_forward(session_id);
        self.params.lock().remove(session_id);
        // Dropping the aux entry drops its Session, closing the auxiliary socket.
        self.aux.lock().remove(session_id);
        // Signal the owner thread to tear down its channel off-lock — we never
        // hold the global map lock across a blocking wait_close().
        if let Some(tx) = self.writers.lock().remove(session_id) {
            let _ = tx.send(SshCmd::Close);
        }
        self.instances.lock().remove(session_id);
    }

    pub fn close_all(&self) {
        self.close_all_local_forwards();
        self.params.lock().clear();
        self.aux.lock().clear();
        let txs: Vec<_> = self.writers.lock().drain().map(|(_, v)| v).collect();
        for tx in txs {
            let _ = tx.send(SshCmd::Close);
        }
        self.instances.lock().clear();
    }

    // ---- SFTP operations ----

    /// Lazily get (or open) the auxiliary connection for this session. Returns
    /// `None` when no stored params exist or a second connection can't be
    /// established (e.g. the server limits concurrent sessions, or a one-time
    /// TOTP can't be reused) — callers then fall back to the interactive session.
    fn get_or_create_aux(&self, session_id: &str) -> Option<Arc<Mutex<AuxSession>>> {
        if let Some(aux) = self.aux.lock().get(session_id) {
            return Some(aux.clone());
        }
        let params = self.params.lock().get(session_id)?.clone();
        // Establish WITHOUT holding the aux map lock (network I/O).
        let session = establish_authenticated_session(&params).ok()?;
        session.set_blocking(true);
        let aux = Arc::new(Mutex::new(AuxSession { session, sftp: None }));
        let mut map = self.aux.lock();
        if let Some(existing) = map.get(session_id) {
            // Another thread won the race while we were connecting.
            return Some(existing.clone());
        }
        map.insert(session_id.to_string(), aux.clone());
        Some(aux)
    }

    /// Run a blocking SSH operation (SFTP / exec) on a session, preferring a
    /// dedicated auxiliary connection so it never contends with the interactive
    /// shell's lock (the old behavior froze the terminal during transfers and
    /// metrics polls). Falls back to the primary session if no aux is available.
    fn with_work_session<T, F>(&self, session_id: &str, f: F) -> Result<T, String>
    where
        F: FnOnce(&Session, &mut Option<ssh2::Sftp>) -> Result<T, String>,
    {
        if let Some(aux) = self.get_or_create_aux(session_id) {
            let mut guard = aux.lock();
            let aux_ref = &mut *guard;
            aux_ref.session.set_blocking(true);
            return f(&aux_ref.session, &mut aux_ref.sftp);
        }
        // Fallback: share the interactive session. Toggle blocking around the op
        // so the reader thread keeps working in non-blocking mode afterward.
        let instance = {
            let instances = self.instances.lock();
            instances
                .get(session_id)
                .ok_or_else(|| "Session not found".to_string())?
                .clone()
        };
        let mut guard = instance.lock();
        let inst_ref = &mut *guard;
        inst_ref.session.set_blocking(true);
        let result = f(&inst_ref.session, &mut inst_ref.sftp);
        inst_ref.session.set_blocking(false);
        result
    }

    /// Helper: ensure the SFTP subsystem on the work session, then run closure.
    fn with_sftp<T, F>(&self, session_id: &str, f: F) -> Result<T, String>
    where
        F: FnOnce(&ssh2::Sftp) -> Result<T, String>,
    {
        self.with_work_session(session_id, |session, sftp_slot| {
            if sftp_slot.is_none() {
                *sftp_slot = Some(
                    session
                        .sftp()
                        .map_err(|e| format!("SFTP init failed: {}", e))?,
                );
            }
            f(sftp_slot.as_ref().unwrap())
        })
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
            let mut local =
                fs::File::create(local_path).map_err(|e| format!("Local create failed: {}", e))?;
            // Stream with a fixed buffer instead of read_to_end so a multi-GB
            // download doesn't allocate the whole file in memory (OOM risk).
            let mut buf = vec![0u8; 256 * 1024];
            loop {
                let n = remote_file
                    .read(&mut buf)
                    .map_err(|e| format!("SFTP read failed: {}", e))?;
                if n == 0 {
                    break;
                }
                local
                    .write_all(&buf[..n])
                    .map_err(|e| format!("Local write failed: {}", e))?;
            }
            local.flush().map_err(|e| format!("Local flush failed: {}", e))?;
            Ok(())
        })
    }

    pub fn sftp_read_text(&self, session_id: &str, remote_path: &str) -> Result<String, String> {
        self.with_sftp(session_id, |sftp| {
            let mut remote_file = sftp
                .open(Path::new(remote_path))
                .map_err(|e| format!("SFTP open failed: {}", e))?;
            let mut buf = Vec::new();
            remote_file
                .read_to_end(&mut buf)
                .map_err(|e| format!("SFTP read failed: {}", e))?;
            String::from_utf8(buf).map_err(|_| "File is not valid UTF-8 text".to_string())
        })
    }

    pub fn sftp_write_text(
        &self,
        session_id: &str,
        remote_path: &str,
        content: &str,
    ) -> Result<(), String> {
        self.with_sftp(session_id, |sftp| {
            let dest = Path::new(remote_path);
            // Preserve the file's existing permission bits across the save.
            let existing_perm = sftp.stat(dest).ok().and_then(|s| s.perm);
            // Write to a temp sibling first; the original is only replaced once
            // the new content is fully written, so an interrupted save can never
            // truncate the file to empty / lose data.
            let tmp_path = format!("{}.gwshell.tmp", remote_path);
            let tmp = Path::new(&tmp_path);
            {
                let mut f = sftp
                    .create(tmp)
                    .map_err(|e| format!("SFTP create failed: {}", e))?;
                f.write_all(content.as_bytes())
                    .map_err(|e| format!("SFTP write failed: {}", e))?;
                let _ = f.flush();
            }
            if let Some(perm) = existing_perm {
                if let Ok(mut st) = sftp.stat(tmp) {
                    st.perm = Some(perm);
                    let _ = sftp.setstat(tmp, st);
                }
            }
            let _ = sftp.unlink(dest);
            sftp.rename(tmp, dest, None).map_err(|e| {
                let _ = sftp.unlink(tmp);
                format!("SFTP save failed: {}", e)
            })?;
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
            let mut local =
                fs::File::open(local_path).map_err(|e| format!("Local read failed: {}", e))?;
            let mut remote_file = sftp
                .create(Path::new(remote_path))
                .map_err(|e| format!("SFTP create failed: {}", e))?;
            // Stream with a fixed buffer instead of reading the whole file into
            // memory (OOM risk on large uploads).
            let mut buf = vec![0u8; 256 * 1024];
            loop {
                let n = local
                    .read(&mut buf)
                    .map_err(|e| format!("Local read failed: {}", e))?;
                if n == 0 {
                    break;
                }
                remote_file
                    .write_all(&buf[..n])
                    .map_err(|e| format!("SFTP write failed: {}", e))?;
            }
            let _ = remote_file.flush();
            // Best-effort: preserve the local file's executable/permission bits.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = local.metadata() {
                    let mode = meta.permissions().mode() & 0o777;
                    drop(remote_file);
                    if let Ok(mut st) = sftp.stat(Path::new(remote_path)) {
                        st.perm = Some(mode);
                        let _ = sftp.setstat(Path::new(remote_path), st);
                    }
                }
            }
            Ok(())
        })
    }

    pub fn sftp_chmod(&self, session_id: &str, path: &str, mode: u32) -> Result<(), String> {
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

    /// Execute a command via a new SSH channel and return stdout. Runs on the
    /// auxiliary connection when available so it never blocks the interactive
    /// terminal (this is what previously made the metrics poll freeze input).
    pub fn ssh_exec(&self, session_id: &str, command: &str) -> Result<String, String> {
        self.with_work_session(session_id, |session, _sftp| {
            let mut ch = session
                .channel_session()
                .map_err(|e| format!("Exec channel failed: {}", e))?;
            ch.exec(command).map_err(|e| format!("Exec failed: {}", e))?;
            let mut output = String::new();
            ch.read_to_string(&mut output)
                .map_err(|e| format!("Exec read failed: {}", e))?;
            ch.wait_close()
                .map_err(|e| format!("Exec close failed: {}", e))?;
            Ok(output.trim().to_string())
        })
    }

    /// Start a local-forward tunnel: each connection to 127.0.0.1:local_port is
    /// forwarded to remote_host:remote_port through a *new* dedicated SSH session.
    /// Returns the actual bound local port (useful when local_port == 0).
    #[allow(clippy::too_many_arguments)]
    pub fn start_local_forward(
        &self,
        session_id: &str,
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
        self.close_local_forward(session_id);

        // Bind local listener first so caller gets the actual port immediately.
        let listener = TcpListener::bind(format!("127.0.0.1:{}", local_port))
            .map_err(|e| format!("Tunnel bind 127.0.0.1:{} failed: {}", local_port, e))?;
        let actual_port = listener
            .local_addr()
            .map_err(|e| format!("Tunnel get port failed: {}", e))?
            .port();
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("Tunnel set nonblocking failed: {}", e))?;
        let stop_flag = Arc::new(AtomicBool::new(false));
        self.forwards.lock().insert(
            session_id.to_string(),
            LocalForward {
                stop_flag: stop_flag.clone(),
                local_port: actual_port,
            },
        );

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
            loop {
                if stop_flag.load(Ordering::Relaxed) {
                    break;
                }

                let client_stream = match listener.accept() {
                    Ok((stream, _)) => stream,
                    Err(ref e) if e.kind() == ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(50));
                        continue;
                    }
                    Err(_) => break,
                };

                // Create a dedicated SSH session for this tunnel connection.
                let tcp_result = if let Some(ref jh) = jump_host.clone().filter(|h| !h.is_empty()) {
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
                            let key_path = expand_tilde(kp);
                            if !key_path.exists() {
                                false
                            } else {
                                tun_sess
                                    .userauth_pubkey_file(
                                        &username,
                                        None,
                                        &key_path,
                                        password.as_deref(),
                                    )
                                    .is_ok()
                            }
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

    pub fn close_local_forward(&self, session_id: &str) {
        if let Some(forward) = self.forwards.lock().remove(session_id) {
            forward.stop_flag.store(true, Ordering::Relaxed);
            let _ = TcpStream::connect(("127.0.0.1", forward.local_port));
        }
    }

    fn close_all_local_forwards(&self) {
        let forwards: Vec<_> = self.forwards.lock().drain().map(|(_, v)| v).collect();
        for forward in forwards {
            forward.stop_flag.store(true, Ordering::Relaxed);
            let _ = TcpStream::connect(("127.0.0.1", forward.local_port));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn expand_tilde_leaves_absolute_path_unchanged() {
        assert_eq!(expand_tilde("/etc/ssh/id_rsa"), PathBuf::from("/etc/ssh/id_rsa"));
    }

    #[test]
    fn expand_tilde_leaves_relative_path_unchanged() {
        assert_eq!(expand_tilde(".ssh/id_rsa"), PathBuf::from(".ssh/id_rsa"));
    }

    #[test]
    fn expand_tilde_expands_bare_tilde() {
        let home = dirs::home_dir().expect("test env should have home dir");
        assert_eq!(expand_tilde("~"), home);
    }

    #[test]
    fn expand_tilde_expands_tilde_slash_prefix() {
        let home = dirs::home_dir().expect("test env should have home dir");
        assert_eq!(expand_tilde("~/.ssh/id_rsa"), home.join(".ssh/id_rsa"));
    }

    #[test]
    fn expand_tilde_does_not_expand_user_specific_tilde() {
        // ~root/foo this OpenSSH form is uncommon, libssh2 doesn't support,
        // we handle literally
        assert_eq!(expand_tilde("~root/foo"), PathBuf::from("~root/foo"));
    }
}
